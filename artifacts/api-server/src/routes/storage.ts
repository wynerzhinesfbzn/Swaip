import { Router, type IRouter, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { requireSession } from "../lib/sessionAuth";
import { nsfwServerCheck } from "../services/nsfwServerCheck";

const router: IRouter = Router();

/* ── Локальное хранилище файлов ── */
const UPLOADS_DIR = path.join(process.cwd(), "media_uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

/* ──────────────────────────────────────────────────
   POST /api/upload  — загружает любой файл локально
   Клиент шлёт сырой бинарный файл.
   Возвращает: { url }
────────────────────────────────────────────────── */
router.post("/upload", requireSession, async (req: Request, res: Response) => {
  try {
    const contentType = (req.headers["content-type"] || "application/octet-stream").split(";")[0].trim();
    const fileName = req.headers["x-file-name"]
      ? decodeURIComponent(String(req.headers["x-file-name"]))
      : "upload";

    /* 1. Читаем тело */
    const rawBody: Buffer = Buffer.isBuffer(req.body)
      ? req.body
      : await new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
          req.on("end", () => resolve(Buffer.concat(chunks)));
          req.on("error", reject);
        });

    if (rawBody.length === 0) {
      res.status(400).json({ error: "Empty file" });
      return;
    }

    /* 2. NSFW-проверка изображений */
    const nsfwResult = await nsfwServerCheck(rawBody, contentType);
    if (nsfwResult.blocked) {
      res.status(451).json({ error: "content_blocked", reason: "nsfw_image" });
      return;
    }

    /* 3. Определяем расширение */
    const ext = getExtension(contentType, fileName);
    const filename = crypto.randomUUID() + ext;
    const filepath = path.join(UPLOADS_DIR, filename);

    /* 4. Сохраняем на диск */
    fs.writeFileSync(filepath, rawBody);

    /* 5. Возвращаем URL */
    const url = `/api/media/${filename}`;
    res.json({ url });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Upload failed" });
  }
});

/* ──────────────────────────────────────────────────
   GET /api/media/:filename  — отдаёт сохранённый файл
────────────────────────────────────────────────── */
router.get("/media/:filename", (req: Request, res: Response) => {
  const filename = String(req.params["filename"]).replace(/[^a-zA-Z0-9.\-_]/g, "");
  const filepath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filepath)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const ext = path.extname(filename).toLowerCase();
  const ct = detectContentType(ext);
  res.setHeader("Content-Type", ct);
  res.setHeader("Cache-Control", "public, max-age=86400");
  fs.createReadStream(filepath).pipe(res);
});

function getExtension(contentType: string, fileName: string): string {
  /* Сначала пробуем по Content-Type */
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  if (contentType.includes("png"))  return ".png";
  if (contentType.includes("gif"))  return ".gif";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("svg"))  return ".svg";
  if (contentType.includes("mp4"))  return ".mp4";
  if (contentType.includes("webm")) return ".webm";
  if (contentType.includes("mov"))  return ".mov";
  if (contentType.includes("mpeg") || contentType.includes("mp3")) return ".mp3";
  if (contentType.includes("ogg"))  return ".ogg";
  if (contentType.includes("wav"))  return ".wav";
  if (contentType.includes("pdf"))  return ".pdf";
  /* Запасной вариант — по имени файла */
  const dotIdx = fileName.lastIndexOf(".");
  if (dotIdx !== -1) return fileName.slice(dotIdx).toLowerCase();
  return ".bin";
}

function detectContentType(ext: string): string {
  switch (ext) {
    case ".jpg": case ".jpeg": return "image/jpeg";
    case ".png":  return "image/png";
    case ".gif":  return "image/gif";
    case ".webp": return "image/webp";
    case ".svg":  return "image/svg+xml";
    case ".mp4":  return "video/mp4";
    case ".webm": return "video/webm";
    case ".mov":  return "video/quicktime";
    case ".mp3":  return "audio/mpeg";
    case ".ogg":  return "audio/ogg";
    case ".wav":  return "audio/wav";
    case ".pdf":  return "application/pdf";
    default:      return "application/octet-stream";
  }
}

export default router;
