import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const SECRET = process.env.SESSION_SECRET || "fallback-dev-secret-change-in-prod";

/* Формат зашифрованного файла в GCS:
   [4 bytes magic "SWME"] [12 bytes IV] [16 bytes AuthTag] [N bytes ciphertext]
*/
const MAGIC = Buffer.from("SWME");

/** Деривирует ключ шифрования из пути файла — уникальный для каждого файла */
function deriveKey(objectPath: string): Buffer {
  return createHmac("sha256", SECRET)
    .update(`swaip_media_v1:${objectPath}`)
    .digest();
}

/** Шифрует Buffer перед отправкой в хранилище */
export function encryptMedia(data: Buffer, objectPath: string): Buffer {
  const key = deriveKey(objectPath);
  const iv  = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, encrypted]);
}

/** Возвращает true если буфер начинается с нашего маркера */
export function isEncryptedMedia(data: Buffer): boolean {
  return data.length > 32 && data.subarray(0, 4).equals(MAGIC);
}

/** Расшифровывает Buffer из хранилища */
export function decryptMedia(data: Buffer, objectPath: string): Buffer {
  if (!isEncryptedMedia(data)) return data; // обратная совместимость со старыми файлами
  try {
    const key     = deriveKey(objectPath);
    const iv      = data.subarray(4, 16);
    const tag     = data.subarray(16, 32);
    const payload = data.subarray(32);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(payload), decipher.final()]);
  } catch {
    throw new Error("Файл повреждён или ключ не совпадает");
  }
}
