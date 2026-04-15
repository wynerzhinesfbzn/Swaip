import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const router = Router();
const AUDIO_DIR = path.join(process.cwd(), "audio_uploads");
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

function getExtFromContentType(ct: string, originalName?: string): string {
  const c = ct.toLowerCase();
  if (c.includes("ogg")) return ".ogg";
  if (c.includes("mp4") || c.includes("m4a") || c.includes("aac")) return ".m4a";
  if (c.includes("mpeg") || c.includes("mp3")) return ".mp3";
  if (c.includes("wav") || c.includes("wave")) return ".wav";
  if (c.includes("flac")) return ".flac";
  if (c.includes("opus")) return ".opus";
  if (c.includes("wma") || c.includes("x-ms-wma")) return ".wma";
  if (c.includes("aiff")) return ".aiff";
  if (originalName) {
    const ext = path.extname(originalName).toLowerCase();
    if ([".mp3",".wav",".ogg",".m4a",".aac",".flac",".opus",".wma",".aiff",".webm"].includes(ext)) return ext;
  }
  return ".webm";
}

/* POST /api/audio-upload — загружает аудиофайл (голосовые посты и музыка)
   Content-Type: любой аудио-тип
   Тело: бинарный blob до 50 МБ
   Ответ: { url: "/api/audio/:filename" } */
router.post("/audio-upload", async (req: Request, res: Response) => {
  try {
    const buf: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    if (buf.length > 50 * 1024 * 1024) { res.status(413).json({ error: "File too large (max 50MB)" }); return; }
    if (buf.length === 0) { res.status(400).json({ error: "Empty file" }); return; }

    const ct = (req.headers["content-type"] || "audio/webm").split(";")[0].trim();
    const originalName = req.headers["x-filename"] as string | undefined;
    const ext = getExtFromContentType(ct, originalName);
    const filename = crypto.randomUUID() + ext;
    fs.writeFileSync(path.join(AUDIO_DIR, filename), buf);

    res.json({ url: `/api/audio/${filename}` });
  } catch {
    res.status(500).json({ error: "Upload failed" });
  }
});

/* GET /api/audio/:filename — отдаёт аудиофайл */
router.get("/audio/:filename", (req: Request, res: Response) => {
  const filename = String(req.params["filename"]).replace(/[^a-zA-Z0-9.\-_]/g, "");
  const filepath = path.join(AUDIO_DIR, filename);
  if (!fs.existsSync(filepath)) { res.status(404).json({ error: "Not found" }); return; }
  const ext = path.extname(filename).toLowerCase();
  const ctMap: Record<string, string> = {
    ".ogg":"audio/ogg",".mp4":"audio/mp4",".m4a":"audio/mp4",".aac":"audio/aac",
    ".mp3":"audio/mpeg",".wav":"audio/wav",".flac":"audio/flac",
    ".opus":"audio/opus",".wma":"audio/x-ms-wma",".aiff":"audio/aiff",
  };
  const ct = ctMap[ext] || "audio/webm";
  res.setHeader("Content-Type", ct);
  res.setHeader("Cache-Control", "public, max-age=86400");
  fs.createReadStream(filepath).pipe(res);
});

export default router;
