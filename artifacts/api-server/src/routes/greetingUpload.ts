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

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout(${ms}ms): ${label}`)), ms)
    ),
  ]);
}

function getExtFromContentType(ct: string, originalName?: string): string {
  const c = ct.toLowerCase();
  if (c.includes("ogg"))  return ".ogg";
  if (c.includes("opus")) return ".opus";
  if (c.includes("mp4") || c.includes("m4a") || c.includes("aac")) return ".m4a";
  if (c.includes("mpeg") || c.includes("mp3")) return ".mp3";
  if (c.includes("wav") || c.includes("wave")) return ".wav";
  if (c.includes("flac")) return ".flac";
  if (originalName) {
    const ext = originalName.split(".").pop()?.toLowerCase() || "";
    if ([".mp3",".wav",".ogg",".m4a",".aac",".flac",".opus",".webm"].includes("." + ext)) return "." + ext;
  }
  return ".webm";
}

function getContentType(ext: string): string {
  const map: Record<string, string> = {
    ".ogg":  "audio/ogg",
    ".opus": "audio/opus",
    ".mp3":  "audio/mpeg",
    ".wav":  "audio/wav",
    ".flac": "audio/flac",
    ".m4a":  "audio/mp4",
    ".aac":  "audio/aac",
    ".webm": "audio/webm",
  };
  return map[ext] || "audio/webm";
}

function saveToLocalDisk(subdir: string, filename: string, buf: Buffer): void {
  const dirs = [
    path.join(process.cwd(), subdir),
    path.join("/tmp", "swaip_uploads", subdir),
  ];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), buf);
      logger.info({ dir, filename }, "saved to local disk");
      return;
    } catch (e) {
      logger.warn({ dir, err: e }, "local disk write failed, trying next path");
    }
  }
  throw new Error("All local disk paths failed");
}

/* POST /api/greeting-upload — сохраняет аудио приветствия в GCS (постоянно)
   Ответ: { url: "/api/greeting/:filename" } */
router.post("/greeting-upload", async (req: Request, res: Response) => {
  try {
    const buf: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    if (buf.length > 50 * 1024 * 1024) {
      res.status(413).json({ error: "File too large (max 50MB)" });
      return;
    }
    if (buf.length === 0) {
      res.status(400).json({ error: "Empty file" });
      return;
    }

    const ct = (req.headers["content-type"] || "audio/webm").split(";")[0].trim();
    const originalName = req.headers["x-filename"] as string | undefined;
    const ext = getExtFromContentType(ct, originalName);
    const filename = crypto.randomUUID() + ext;
    const objectName = `greetings/${filename}`;

    /* ── Попытка 1: GCS ── */
    try {
      const bucket = getBucket();
      const file = bucket.file(objectName);
      await withTimeout(
        file.save(buf, { contentType: ct, resumable: false }),
        10_000,
        "gcs.save.greeting"
      );
      logger.info({ filename, bytes: buf.length }, "greeting saved to GCS");
      res.json({ url: `/api/greeting/${filename}` });
      return;
    } catch (gcsErr) {
      logger.warn({ err: gcsErr, filename }, "GCS greeting upload failed, falling back to local disk");
    }

    /* ── Попытка 2: локальный диск ── */
    try {
      saveToLocalDisk("greeting_uploads", filename, buf);
      res.json({ url: `/api/greeting/${filename}` });
    } catch (diskErr) {
      logger.error({ err: diskErr, filename }, "local disk greeting fallback also failed");
      res.status(500).json({ error: "Upload failed: storage unavailable" });
    }
  } catch (err) {
    logger.error({ err }, "greetingUpload unexpected error");
    res.status(500).json({ error: "Upload failed" });
  }
});

/* GET /api/greeting/:filename — отдаёт аудио (сначала GCS, потом локальный диск) */
router.get("/greeting/:filename", async (req: Request, res: Response) => {
  const filename = String(req.params["filename"]).replace(/[^a-zA-Z0-9.\-_]/g, "");
  const objectName = `greetings/${filename}`;
  const ext = "." + (filename.split(".").pop()?.toLowerCase() || "webm");
  const ct = getContentType(ext);

  try {
    const bucket = getBucket();
    const file = bucket.file(objectName);
    const [exists] = await withTimeout(file.exists(), 5_000, "gcs.exists.greeting");
    if (exists) {
      res.setHeader("Content-Type", ct);
      res.setHeader("Cache-Control", "public, max-age=31536000");
      file.createReadStream().pipe(res);
      return;
    }
  } catch { /* GCS недоступен */ }

  /* Fallback: локальный диск (обе директории) */
  const diskDirs = [
    path.join(process.cwd(), "greeting_uploads"),
    path.join("/tmp", "swaip_uploads", "greeting_uploads"),
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
