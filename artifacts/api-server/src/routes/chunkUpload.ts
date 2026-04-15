/**
 * Универсальная чанковая загрузка файлов.
 * POST /api/upload-chunk    — принимает один чанк
 * POST /api/upload-finalize — собирает чанки и сохраняет в GCS (изображения) или локальный диск
 *
 * Формат запроса (фронтенд):
 *   Chunk:    headers: x-upload-id, x-chunk-index, x-total-chunks, x-file-name, Content-Type
 *   Finalize: JSON { uploadId, totalChunks, fileName, contentType }
 */
import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";
import { objectStorageClient } from "../lib/objectStorage";
import { logger } from "../lib/logger";

const router = Router();

const TMP_DIR = path.join(os.tmpdir(), "swaip_chunks");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

/* Хранилище мета-информации об активных загрузках */
const uploads = new Map<string, { totalChunks: number; received: Set<number> }>();

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

function saveToLocalDisk(subdir: string, filename: string, buf: Buffer): void {
  const dirs = [
    path.join(process.cwd(), subdir),
    path.join(os.tmpdir(), "swaip_uploads", subdir),
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

function getImageExt(contentType: string, fileName: string): string | null {
  const ct = contentType.toLowerCase();
  if (ct.includes("png"))  return ".png";
  if (ct.includes("gif"))  return ".gif";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("svg"))  return ".svg";
  if (ct.includes("jpeg") || ct.includes("jpg")) return ".jpg";
  const ext = path.extname(fileName).toLowerCase();
  if ([".jpg",".jpeg",".png",".gif",".webp",".svg"].includes(ext)) return ext;
  return null;
}

/* POST /api/upload-chunk
   Headers: x-upload-id, x-chunk-index, x-total-chunks, x-file-name
   Body: raw binary (≤ 8MB) */
router.post("/upload-chunk", (req: Request, res: Response) => {
  try {
    const uploadId   = String(req.headers["x-upload-id"]    || "");
    const chunkIndex = parseInt(String(req.headers["x-chunk-index"]  || "0"), 10);
    const totalChunks = parseInt(String(req.headers["x-total-chunks"] || "1"), 10);

    if (!uploadId) { res.status(400).json({ error: "missing x-upload-id" }); return; }

    const buf: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    if (buf.length === 0) { res.status(400).json({ error: "empty chunk" }); return; }

    /* Создаём директорию для чанков */
    const chunkDir = path.join(TMP_DIR, uploadId.replace(/[^a-zA-Z0-9_-]/g, ""));
    if (!fs.existsSync(chunkDir)) fs.mkdirSync(chunkDir, { recursive: true });

    /* Записываем чанк */
    const chunkPath = path.join(chunkDir, `chunk_${String(chunkIndex).padStart(6, "0")}`);
    fs.writeFileSync(chunkPath, buf);

    /* Обновляем мета-информацию */
    if (!uploads.has(uploadId)) {
      uploads.set(uploadId, { totalChunks, received: new Set() });
    }
    const info = uploads.get(uploadId)!;
    info.received.add(chunkIndex);

    logger.info({ uploadId, chunkIndex, bytes: buf.length }, "chunk received");
    res.json({ ok: true, received: info.received.size });
  } catch (err) {
    logger.error({ err }, "upload-chunk error");
    res.status(500).json({ error: "chunk failed" });
  }
});

/* POST /api/upload-finalize
   Body JSON: { uploadId, totalChunks, fileName, contentType }
   Response: { url: string } */
router.post("/upload-finalize", async (req: Request, res: Response) => {
  try {
    const body = req.body as { uploadId?: string; totalChunks?: number; fileName?: string; contentType?: string };
    const { uploadId, fileName = "file", contentType = "application/octet-stream" } = body;

    if (!uploadId) { res.status(400).json({ error: "missing uploadId" }); return; }

    const safeName = uploadId.replace(/[^a-zA-Z0-9_-]/g, "");
    const chunkDir = path.join(TMP_DIR, safeName);

    if (!fs.existsSync(chunkDir)) {
      res.status(400).json({ error: "chunks directory missing — upload may have expired" });
      return;
    }

    const chunks = fs.readdirSync(chunkDir)
      .filter(f => f.startsWith("chunk_"))
      .sort();

    if (chunks.length === 0) {
      res.status(400).json({ error: "no chunks found" });
      return;
    }

    /* Собираем все чанки в один буфер */
    const parts: Buffer[] = chunks.map(c => fs.readFileSync(path.join(chunkDir, c)));
    const assembled = Buffer.concat(parts);

    logger.info({ uploadId, chunks: chunks.length, bytes: assembled.length, contentType }, "finalizing chunked upload");

    /* Определяем: изображение или нет */
    const imageExt = getImageExt(contentType, fileName);
    const isImage = imageExt !== null;

    const ext = isImage ? imageExt : (path.extname(fileName) || ".bin");
    const filename = crypto.randomUUID() + ext;

    let url: string;

    if (isImage) {
      /* ── Изображения → GCS (постоянное хранилище) ── */
      let savedToGcs = false;
      try {
        const bucket = getBucket();
        const objectName = `images/${filename}`;
        const file = bucket.file(objectName);
        await withTimeout(
          file.save(assembled, { contentType, resumable: false }),
          15_000,
          "gcs.save.finalize"
        );
        logger.info({ filename, bytes: assembled.length }, "chunked image saved to GCS");
        savedToGcs = true;
        url = `/api/image/${filename}`;
      } catch (gcsErr) {
        logger.warn({ err: gcsErr, filename }, "GCS finalize failed, falling back to local disk");
      }
      if (!savedToGcs) {
        saveToLocalDisk("image_uploads", filename, assembled);
        url = `/api/image/${filename}`;
      }
    } else {
      /* ── Прочие файлы (видео, документы) → локальный диск ── */
      saveToLocalDisk("upload_finals", filename, assembled);
      url = `/api/upload/${filename}`;
    }

    /* Очищаем временные чанки */
    try {
      fs.rmSync(chunkDir, { recursive: true, force: true });
      uploads.delete(uploadId);
    } catch { /* не критично */ }

    res.json({ url });
  } catch (err) {
    logger.error({ err }, "upload-finalize error");
    res.status(500).json({ error: "finalize failed" });
  }
});

export default router;
