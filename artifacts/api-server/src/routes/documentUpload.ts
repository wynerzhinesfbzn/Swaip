import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const router = Router();
const DOC_DIR = path.join(process.cwd(), "doc_uploads");
if (!fs.existsSync(DOC_DIR)) fs.mkdirSync(DOC_DIR, { recursive: true });

const ALLOWED_EXTS = new Set([
  ".pdf", ".txt", ".doc", ".docx", ".ppt", ".pptx",
  ".xls", ".xlsx", ".csv", ".html", ".htm", ".md",
  ".rtf", ".odt", ".odp", ".ods", ".json", ".xml",
]);

function safeExt(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXTS.has(ext) ? ext : ".bin";
}

function mimeForExt(ext: string): string {
  switch (ext) {
    case ".pdf":  return "application/pdf";
    case ".txt":  return "text/plain; charset=utf-8";
    case ".html": case ".htm": return "text/html; charset=utf-8";
    case ".md":   return "text/markdown; charset=utf-8";
    case ".csv":  return "text/csv; charset=utf-8";
    case ".json": return "application/json";
    case ".xml":  return "application/xml";
    case ".doc":  return "application/msword";
    case ".docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".ppt":  return "application/vnd.ms-powerpoint";
    case ".pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".xls":  return "application/vnd.ms-excel";
    case ".xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".odt":  return "application/vnd.oasis.opendocument.text";
    case ".odp":  return "application/vnd.oasis.opendocument.presentation";
    case ".ods":  return "application/vnd.oasis.opendocument.spreadsheet";
    default:      return "application/octet-stream";
  }
}

/* POST /api/doc-upload
   Headers: x-filename — имя файла
   Body: binary blob (≤ 50MB)
   Response: { url: "/api/doc/:filename" } */
router.post("/doc-upload", (req: Request, res: Response) => {
  try {
    const buf: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    if (buf.length > 50 * 1024 * 1024) { res.status(413).json({ error: "File too large (max 50MB)" }); return; }
    if (buf.length === 0) { res.status(400).json({ error: "Empty file" }); return; }

    const rawName = String(req.headers["x-filename"] || "document").replace(/[^a-zA-Z0-9.\-_ ]/g, "");
    const ext = safeExt(rawName);
    const filename = crypto.randomUUID() + ext;
    fs.writeFileSync(path.join(DOC_DIR, filename), buf);

    res.json({ url: `/api/doc/${filename}` });
  } catch {
    res.status(500).json({ error: "Upload failed" });
  }
});

/* GET /api/doc/:filename */
router.get("/doc/:filename", (req: Request, res: Response) => {
  const filename = String(req.params["filename"]).replace(/[^a-zA-Z0-9.\-_]/g, "");
  const filepath = path.join(DOC_DIR, filename);
  if (!fs.existsSync(filepath)) { res.status(404).json({ error: "Not found" }); return; }
  const ext  = path.extname(filename).toLowerCase();
  const mime = mimeForExt(ext);
  /* Override security headers — allow embedding in same-origin iframe */
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
  res.setHeader("Content-Type", mime);
  res.setHeader("Cache-Control", "public, max-age=86400");
  fs.createReadStream(filepath).pipe(res);
});

export default router;
