import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { objectStorageClient } from "../lib/objectStorage";
import { logger } from "../lib/logger";

const router = Router();

function getBucket() {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
  return objectStorageClient.bucket(bucketId);
}

/** Таймаут-обёртка: бросает если промис не разрешился за ms миллисекунд */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout(${ms}ms): ${label}`)), ms)
    ),
  ]);
}

/** Записывает файл на диск: сначала пробует рабочую директорию, потом /tmp */
function saveToLocalDisk(subdir: string, filename: string, buf: Buffer): string {
  const dirs = [
    path.join(process.cwd(), subdir),
    path.join("/tmp", "swaip_uploads", subdir),
  ];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), buf);
      logger.info({ dir, filename }, "saved to local disk");
      return dir;
    } catch (e) {
      logger.warn({ dir, err: e }, "local disk write failed, trying next path");
    }
  }
  throw new Error("All local disk paths failed");
}

/* POST /api/image-upload — загружает изображение в GCS (постоянное хранилище)
   Content-Type: image/jpeg | image/png | image/webp | image/gif
   Тело: бинарный blob
   Ответ: { url: "/api/image/:filename" } */
router.post("/image-upload", async (req: Request, res: Response) => {
  try {
    const buf: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    if (buf.length > 20 * 1024 * 1024) {
      res.status(413).json({ error: "File too large (max 20MB)" });
      return;
    }
    if (buf.length === 0) {
      res.status(400).json({ error: "Empty file" });
      return;
    }

    const ct = (req.headers["content-type"] || "image/jpeg").split(";")[0].trim();
    const ext = ct.includes("png") ? ".png"
      : ct.includes("gif")  ? ".gif"
      : ct.includes("webp") ? ".webp"
      : ct.includes("svg")  ? ".svg"
      : ".jpg";
    const filename = crypto.randomUUID() + ext;
    const objectName = `images/${filename}`;

    /* ── Попытка 1: GCS (постоянное хранилище) ── */
    try {
      const bucket = getBucket();
      const file = bucket.file(objectName);
      await withTimeout(
        file.save(buf, { contentType: ct, resumable: false }),
        10_000,
        "gcs.save"
      );
      logger.info({ filename, bytes: buf.length }, "image saved to GCS");
      res.json({ url: `/api/image/${filename}` });
      return;
    } catch (gcsErr) {
      logger.warn({ err: gcsErr, filename }, "GCS upload failed, falling back to local disk");
    }

    /* ── Попытка 2: локальный диск (эфемерное хранилище, работает в dev) ── */
    try {
      saveToLocalDisk("image_uploads", filename, buf);
      res.json({ url: `/api/image/${filename}` });
      return;
    } catch (diskErr) {
      logger.error({ err: diskErr, filename }, "local disk fallback also failed");
      res.status(500).json({ error: "Upload failed: storage unavailable" });
    }
  } catch (err) {
    logger.error({ err }, "imageUpload unexpected error");
    res.status(500).json({ error: "Upload failed" });
  }
});

/* GET /api/image/:filename — отдаёт изображение (сначала GCS, потом локальный диск) */
router.get("/image/:filename", async (req: Request, res: Response) => {
  const filename = String(req.params["filename"]).replace(/[^a-zA-Z0-9.\-_]/g, "");
  const objectName = `images/${filename}`;

  const ext = filename.split('.').pop()?.toLowerCase() || 'jpg';
  const ct = ext === "png"  ? "image/png"
    : ext === "gif"  ? "image/gif"
    : ext === "webp" ? "image/webp"
    : ext === "svg"  ? "image/svg+xml"
    : "image/jpeg";

  /* Попытка из GCS */
  try {
    const bucket = getBucket();
    const file = bucket.file(objectName);
    const [exists] = await withTimeout(file.exists(), 5_000, "gcs.exists");
    if (exists) {
      res.setHeader("Content-Type", ct);
      res.setHeader("Cache-Control", "public, max-age=31536000");
      file.createReadStream().pipe(res);
      return;
    }
  } catch { /* GCS недоступен — продолжаем */ }

  /* Fallback: локальный диск (обе директории) */
  const diskDirs = [
    path.join(process.cwd(), "image_uploads"),
    path.join("/tmp", "swaip_uploads", "image_uploads"),
  ];
  for (const dir of diskDirs) {
    try {
      const filepath = path.join(dir, filename);
      if (fs.existsSync(filepath)) {
        res.setHeader("Content-Type", ct);
        res.setHeader("Cache-Control", "public, max-age=86400");
        fs.createReadStream(filepath).pipe(res);
        return;
      }
    } catch { /* продолжаем */ }
  }

  res.status(404).json({ error: "Not found" });
});

export default router;
