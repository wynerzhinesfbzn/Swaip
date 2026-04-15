import { createHmac, randomBytes } from "node:crypto";
import { db, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";

const SECRET = process.env.SESSION_SECRET || "fallback-dev-secret-change-in-prod";

export function generateSessionToken(userHash: string): string {
  const random = randomBytes(32).toString("hex");
  const mac = createHmac("sha256", SECRET).update(`${userHash}:${random}`).digest("hex");
  return `${random}.${mac}`;
}


export async function resolveSession(token: string): Promise<string | null> {
  if (!token) return null;
  try {
    const rows = await db.select()
      .from(sessionsTable)
      .where(eq(sessionsTable.token, token))
      .limit(1);
    if (!rows.length) return null;
    const session = rows[0];
    if (new Date(session.expiresAt) < new Date()) {
      await db.delete(sessionsTable).where(eq(sessionsTable.token, token));
      return null;
    }
    return session.userHash;
  } catch {
    return null;
  }
}

export async function createSession(userHash: string): Promise<string> {
  const token = generateSessionToken(userHash);
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  await db.insert(sessionsTable).values({ token, userHash, expiresAt });
  return token;
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.token, token));
}

export async function deleteAllUserSessions(userHash: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.userHash, userHash));
}

/* Скользящее окно: продлеваем сессию если осталось < 30 дней */
export async function renewSessionIfNeeded(token: string): Promise<void> {
  try {
    const rows = await db.select().from(sessionsTable).where(eq(sessionsTable.token, token)).limit(1);
    if (!rows.length) return;
    const session = rows[0];
    const msLeft = new Date(session.expiresAt).getTime() - Date.now();
    if (msLeft < 30 * 24 * 60 * 60 * 1000) {
      const newExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      await db.update(sessionsTable).set({ expiresAt: newExpiry }).where(eq(sessionsTable.token, token));
    }
  } catch {}
}

const COOKIE_NAME = "swaip_token";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // seconds

/** Ставит httpOnly cookie в ответ */
export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE * 1000,
    path: "/",
  });
}

/** Удаляет cookie */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

/** Читает токен: сначала из httpOnly cookie, потом из заголовка (обратная совместимость) */
export function getSessionToken(req: Request): string {
  const cookie = (req as any).cookies?.[COOKIE_NAME];
  if (cookie) return cookie;
  const h = req.headers["x-session-token"];
  return (Array.isArray(h) ? h[0] : h) ?? "";
}

export async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = getSessionToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const userHash = await resolveSession(token);
  if (!userHash) {
    res.status(401).json({ error: "Session expired or invalid" });
    return;
  }
  (req as any).userHash = userHash;
  next();
}
