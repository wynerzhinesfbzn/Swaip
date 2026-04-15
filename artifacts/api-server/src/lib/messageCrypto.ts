import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const SECRET = process.env.SESSION_SECRET || "fallback-dev-secret-change-in-prod";
const ENC_PREFIX = "enc:";

function deriveKey(convId: number): Buffer {
  return createHmac("sha256", SECRET)
    .update(`swaip_msg_v1:${convId}`)
    .digest();
}

export function encryptMessage(content: string, convId: number): string {
  if (!content) return content;
  try {
    const key = deriveKey(convId);
    const iv  = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(content, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ENC_PREFIX + Buffer.concat([iv, tag, encrypted]).toString("base64");
  } catch {
    return content;
  }
}

export function decryptMessage(content: string, convId: number): string {
  if (!content) return content;
  if (!content.startsWith(ENC_PREFIX)) return content;
  try {
    const buf = Buffer.from(content.slice(ENC_PREFIX.length), "base64");
    if (buf.length < 29) return content;
    const key     = deriveKey(convId);
    const iv      = buf.subarray(0, 12);
    const tag     = buf.subarray(12, 28);
    const data    = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(data) + decipher.final("utf8");
  } catch {
    return "[сообщение повреждено]";
  }
}
