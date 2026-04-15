import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { db, accountsTable, sessionsTable, loginLogsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  createSession, deleteSession, deleteAllUserSessions,
  resolveSession, getSessionToken, renewSessionIfNeeded,
  setSessionCookie, clearSessionCookie,
} from "../lib/sessionAuth.js";

const router: IRouter = Router();

/* ── Rate limiting (per IP) ── */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function rateLimit(ip: string, maxPerMinute = 10): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= maxPerMinute) return false;
  entry.count++;
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (entry.resetAt < now) rateLimitMap.delete(ip);
  }
}, 5 * 60_000);

/* ── Pending challenges (nonce) ── */
const pendingChallenges = new Map<string, { nonce: string; expiresAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingChallenges) {
    if (val.expiresAt < now) pendingChallenges.delete(key);
  }
}, 60_000);

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function getIP(req: any): string {
  return ((req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown")
    .split(",")[0].trim();
}
function getUA(req: any): string {
  return (req.headers["user-agent"] as string) || "";
}

async function logLogin(userHash: string, req: any, success: boolean, reason?: string) {
  try {
    await db.insert(loginLogsTable).values({
      userHash, ip: getIP(req), userAgent: getUA(req), success, reason,
    });
  } catch {}
}

/* ─────────────────────────────────────────────────
   GET /session/challenge  — выдаёт nonce для Ed25519
───────────────────────────────────────────────── */
router.get("/session/challenge", async (req, res) => {
  const hash = (req.query.hash as string) || "";
  if (!hash || hash.length < 32) {
    return res.status(400).json({ error: "Неверный ключ" });
  }
  const ip = getIP(req);
  if (!rateLimit(ip, 20)) {
    return res.status(429).json({ error: "Слишком много попыток. Подождите минуту." });
  }
  const nonce = randomBytes(32).toString("hex");
  pendingChallenges.set(hash, { nonce, expiresAt: Date.now() + 90_000 });
  return res.json({ nonce, ok: true });
});

/* ─────────────────────────────────────────────────
   POST /session/create  — создаёт или верифицирует сессию
───────────────────────────────────────────────── */
router.post("/session/create", async (req, res) => {
  const ip = getIP(req);
  if (!rateLimit(ip, 15)) {
    return res.status(429).json({ error: "Слишком много попыток. Подождите минуту." });
  }

  const { hash, publicKey, nonce, signature } = req.body as {
    hash?: string; publicKey?: string; nonce?: string; signature?: string;
  };

  if (!hash || typeof hash !== "string" || hash.length < 32) {
    return res.status(400).json({ error: "Неверный ключ" });
  }
  if (!publicKey || typeof publicKey !== "string" || publicKey.length !== 64) {
    return res.status(400).json({ error: "Неверный открытый ключ" });
  }

  try {
    const rows = await db.select().from(accountsTable).where(eq(accountsTable.hash, hash)).limit(1);
    const account = rows[0] ?? null;

    /* Аккаунт не найден — только при явной регистрации создаём новый */
    if (!account) {
      const allowRegister = req.headers["x-allow-register"] === "1";
      if (!allowRegister) {
        /* Вход через "У меня уже есть мастер-ключ" → аккаунт не существует */
        await logLogin(hash, req, false, "account_not_found");
        return res.status(401).json({ error: "Ключ не найден — проверьте слова" });
      }
      /* Регистрация нового аккаунта */
      await db.insert(accountsTable).values({ hash, publicKey, data: {} }).onConflictDoNothing();
      const token = await createSession(hash);
      setSessionCookie(res, token);
      await logLogin(hash, req, true, "new_account");
      return res.json({ token, ok: true, isNew: true });
    }

    /* Аккаунт существует, но публичный ключ ещё не сохранён (миграция старых аккаунтов) */
    if (!account.publicKey) {
      await db.update(accountsTable).set({ publicKey }).where(eq(accountsTable.hash, hash));
      const token = await createSession(hash);
      setSessionCookie(res, token);
      await logLogin(hash, req, true, "pubkey_upgrade");
      return res.json({ token, ok: true, upgraded: true });
    }

    /* Проверка публичного ключа */
    const storedPubKey = account.publicKey;
    if (storedPubKey !== publicKey) {
      await logLogin(hash, req, false, "wrong_public_key");
      return res.status(401).json({ error: "Ключ не совпадает", needChallenge: true });
    }

    /* Проверка Ed25519 подписи */
    const challenge = pendingChallenges.get(hash);
    if (!nonce || !signature || !challenge) {
      return res.status(401).json({ error: "Требуется подтверждение", needChallenge: true });
    }
    if (challenge.nonce !== nonce || challenge.expiresAt < Date.now()) {
      pendingChallenges.delete(hash);
      await logLogin(hash, req, false, "nonce_expired");
      return res.status(401).json({ error: "Код подтверждения устарел", needChallenge: true });
    }

    let valid = false;
    try {
      valid = ed25519.verify(hexToBytes(signature), hexToBytes(nonce), hexToBytes(storedPubKey));
    } catch { valid = false; }

    pendingChallenges.delete(hash);

    if (!valid) {
      await logLogin(hash, req, false, "bad_signature");
      return res.status(401).json({ error: "Неверный мастер-ключ" });
    }

    const token = await createSession(hash);
    setSessionCookie(res, token);
    await logLogin(hash, req, true);
    return res.json({ token, ok: true });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

/* ─────────────────────────────────────────────────
   POST /session/verify
───────────────────────────────────────────────── */
router.post("/session/verify", async (req, res) => {
  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ ok: false });
  const userHash = await resolveSession(token);
  if (!userHash) return res.status(401).json({ ok: false });
  await renewSessionIfNeeded(token);
  return res.json({ ok: true, hash: userHash, token });
});

/* ─────────────────────────────────────────────────
   POST /session/logout
───────────────────────────────────────────────── */
router.post("/session/logout", async (req, res) => {
  const token = getSessionToken(req);
  if (token) await deleteSession(token);
  clearSessionCookie(res);
  return res.json({ ok: true });
});

/* ─────────────────────────────────────────────────
   POST /session/logout-all
───────────────────────────────────────────────── */
router.post("/session/logout-all", async (req, res) => {
  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  const userHash = await resolveSession(token);
  if (!userHash) return res.status(401).json({ error: "Session expired" });
  await deleteAllUserSessions(userHash);
  clearSessionCookie(res);
  return res.json({ ok: true });
});

/* ─────────────────────────────────────────────────
   GET /session/login-log — история входов
───────────────────────────────────────────────── */
router.get("/session/login-log", async (req, res) => {
  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  const userHash = await resolveSession(token);
  if (!userHash) return res.status(401).json({ error: "Session expired" });

  const logs = await db.select({
    ip:        loginLogsTable.ip,
    userAgent: loginLogsTable.userAgent,
    success:   loginLogsTable.success,
    reason:    loginLogsTable.reason,
    createdAt: loginLogsTable.createdAt,
  })
    .from(loginLogsTable)
    .where(eq(loginLogsTable.userHash, userHash))
    .orderBy(desc(loginLogsTable.createdAt))
    .limit(20);

  return res.json({ logs, ok: true });
});

/* ─────────────────────────────────────────────────
   GET /session/me  — возвращает хеш текущего пользователя (или 401)
   Используется клиентом для проверки: «залогинен ли я?»
───────────────────────────────────────────────── */
router.get("/session/me", async (req, res) => {
  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ ok: false });
  try {
    await renewSessionIfNeeded(token);
  } catch {}
  const userHash = await resolveSession(token);
  if (!userHash) return res.status(401).json({ ok: false });
  return res.json({ ok: true, hash: userHash });
});

export default router;
