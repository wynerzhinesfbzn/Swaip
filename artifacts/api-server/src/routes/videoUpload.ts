import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const router = Router();
const VID_DIR = path.join(process.cwd(), "video_uploads");
const TMP_DIR = path.join(process.cwd(), "video_uploads_tmp");
if (!fs.existsSync(VID_DIR)) fs.mkdirSync(VID_DIR, { recursive: true });
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

/* Хранилище активных chunked-загрузок в памяти */
const uploads = new Map<string, { ext: string; mime: string; totalChunks: number; received: Set<number> }>();

/* ── Вспомогательные функции ─────────────────────────────── */

function resolveVideo(ct: string, filename = ""): { ext: string; mime: string } {
  /* Сначала пробуем расширение файла — оно точнее MIME */
  const nameExt = path.extname(filename).toLowerCase();
  if (nameExt === ".webm") return { ext: ".webm", mime: "video/webm" };
  if (nameExt === ".ogv")  return { ext: ".ogv",  mime: "video/ogg" };
  if (nameExt === ".avi")  return { ext: ".avi",  mime: "video/x-msvideo" };
  if (nameExt === ".mkv")  return { ext: ".mkv",  mime: "video/x-matroska" };
  if (nameExt === ".3gp")  return { ext: ".3gp",  mime: "video/3gpp" };
  if (nameExt === ".mov")  return { ext: ".mov",  mime: "video/mp4" };
  if (nameExt === ".mp4")  return { ext: ".mp4",  mime: "video/mp4" };

  /* Запасной вариант — Content-Type */
  const t = ct.toLowerCase();
  if (t.includes("webm"))                             return { ext: ".webm", mime: "video/webm" };
  if (t.includes("ogg"))                              return { ext: ".ogv",  mime: "video/ogg" };
  if (t.includes("quicktime") || t.includes("mov"))   return { ext: ".mov",  mime: "video/mp4" };
  if (t.includes("x-msvideo") || t.includes("avi"))   return { ext: ".avi",  mime: "video/x-msvideo" };
  if (t.includes("x-matroska") || t.includes("mkv"))  return { ext: ".mkv",  mime: "video/x-matroska" };
  if (t.includes("3gp"))                              return { ext: ".3gp",  mime: "video/3gpp" };
  return { ext: ".mp4", mime: "video/mp4" };
}

function mimeByExt(ext: string): string {
  switch (ext) {
    case ".webm": return "video/webm";
    case ".ogv":  return "video/ogg";
    case ".avi":  return "video/x-msvideo";
    case ".mkv":  return "video/x-matroska";
    case ".3gp":  return "video/3gpp";
    default:      return "video/mp4";   /* .mp4 .mov и всё остальное */
  }
}

/* ── Chunked upload ──────────────────────────────────────── */

/* POST /api/video-upload/init
   Body JSON: { filename: string, totalChunks: number }
   Response: { uploadId: string } */
router.post("/video-upload/init", (req: Request, res: Response) => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString("utf8")) : req.body;
    const { filename = "", totalChunks = 1 } = rawBody as { filename?: string; totalChunks?: number };
    const rawCt = (req.headers["content-type"] || "video/mp4").split(";")[0].trim();
    const { ext, mime } = resolveVideo(rawCt, filename);
    const uploadId = crypto.randomUUID();
    uploads.set(uploadId, { ext, mime, totalChunks: Number(totalChunks), received: new Set() });
    /* Создаём папку для чанков */
    fs.mkdirSync(path.join(TMP_DIR, uploadId), { recursive: true });
    res.json({ uploadId });
  } catch {
    res.status(500).json({ error: "init failed" });
  }
});

/* POST /api/video-upload/chunk
   Headers: x-upload-id, x-chunk-index
   Body: raw binary (≤ 8MB)
   Response: { ok: true, received: number } */
router.post("/video-upload/chunk", (req: Request, res: Response) => {
  try {
    const uploadId   = String(req.headers["x-upload-id"]    || "");
    const chunkIndex = parseInt(String(req.headers["x-chunk-index"] || "0"), 10);
    const info = uploads.get(uploadId);
    if (!info) { res.status(400).json({ error: "unknown uploadId" }); return; }

    const buf: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    if (buf.length === 0) { res.status(400).json({ error: "empty chunk" }); return; }

    const chunkPath = path.join(TMP_DIR, uploadId, `chunk_${String(chunkIndex).padStart(6, "0")}`);
    fs.writeFileSync(chunkPath, buf);
    info.received.add(chunkIndex);
    res.json({ ok: true, received: info.received.size });
  } catch {
    res.status(500).json({ error: "chunk failed" });
  }
});

/* POST /api/video-upload/finalize
   Body JSON: { uploadId: string }
   Response: { url: string, mime: string } */
router.post("/video-upload/finalize", (req: Request, res: Response) => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString("utf8")) : req.body;
    const { uploadId } = rawBody as { uploadId: string };
    if (!uploadId) { res.status(400).json({ error: "missing uploadId" }); return; }

    const chunkDir = path.join(TMP_DIR, uploadId);

    /* Если Map запись есть — используем её; если нет (сервер перезапускался) —
       восстанавливаем из диска с дефолтным .webm */
    const info = uploads.get(uploadId) ?? (
      fs.existsSync(chunkDir)
        ? { ext: ".webm", mime: "video/webm", totalChunks: 0, received: new Set<number>() }
        : null
    );

    if (!info) { res.status(400).json({ error: "unknown uploadId" }); return; }

    if (!fs.existsSync(chunkDir)) { res.status(400).json({ error: "chunks directory missing" }); return; }

    const chunks = fs.readdirSync(chunkDir).filter(f => f.startsWith("chunk_")).sort();
    if (chunks.length === 0) { res.status(400).json({ error: "no chunks" }); return; }

    const filename  = crypto.randomUUID() + info.ext;
    const outPath   = path.join(VID_DIR, filename);
    const outStream = fs.createWriteStream(outPath);

    for (const chunk of chunks) {
      const data = fs.readFileSync(path.join(chunkDir, chunk));
      outStream.write(data);
    }
    outStream.end();

    /* Cleanup */
    fs.rmSync(chunkDir, { recursive: true, force: true });
    uploads.delete(uploadId);

    res.json({ url: `/api/video/${filename}`, mime: info.mime });
  } catch (err) {
    console.error("finalize error:", err);
    res.status(500).json({ error: "finalize failed" });
  }
});

/* ── Прямая загрузка (маленькие файлы < ~20MB) ───────────── */

/* POST /api/video-upload
   Content-Type: video/*,  x-filename: имя файла
   Body: raw binary
   Response: { url, mime } */
router.post("/video-upload", (req: Request, res: Response) => {
  try {
    const buf: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    if (buf.length > 150 * 1024 * 1024) { res.status(413).json({ error: "File too large (max 150MB)" }); return; }
    if (buf.length === 0) { res.status(400).json({ error: "Empty file" }); return; }

    const rawCt = (req.headers["content-type"] || "video/mp4").split(";")[0].trim();
    const clientFilename = String(req.headers["x-filename"] || "").replace(/[^a-zA-Z0-9.\-_ ]/g, "");
    const { ext, mime } = resolveVideo(rawCt, clientFilename);

    const filename = crypto.randomUUID() + ext;
    fs.writeFileSync(path.join(VID_DIR, filename), buf);
    res.json({ url: `/api/video/${filename}`, mime });
  } catch {
    res.status(500).json({ error: "Upload failed" });
  }
});

/* ── Отдача видео с Range-request ───────────────────────── */

/* GET /api/video/:filename */
router.get("/video/:filename", (req: Request, res: Response) => {
  const filename = String(req.params["filename"]).replace(/[^a-zA-Z0-9.\-_]/g, "");
  const filepath = path.join(VID_DIR, filename);
  if (!fs.existsSync(filepath)) { res.status(404).json({ error: "Not found" }); return; }
  const ext  = path.extname(filename).toLowerCase();
  const mime = mimeByExt(ext);
  res.setHeader("Content-Type", mime);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "public, max-age=86400");
  const stat  = fs.statSync(filepath);
  const total = stat.size;
  const rangeHeader = req.headers["range"];
  if (rangeHeader) {
    const parts     = rangeHeader.replace(/bytes=/, "").split("-");
    const start     = parseInt(parts[0], 10);
    const end       = parts[1] ? parseInt(parts[1], 10) : total - 1;
    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader("Content-Range",  `bytes ${start}-${end}/${total}`);
    res.setHeader("Content-Length", chunkSize);
    fs.createReadStream(filepath, { start, end }).pipe(res);
  } else {
    res.setHeader("Content-Length", total);
    fs.createReadStream(filepath).pipe(res);
  }
});

export default router;
