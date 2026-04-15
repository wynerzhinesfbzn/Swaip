/* ═══════════════════════════════════════════════════════════════════
   SWAIP — Маршруты модерации
   POST /moderation/report  — пожаловаться на контент
   GET  /moderation/status  — проверить бан текущего пользователя
═══════════════════════════════════════════════════════════════════ */
import { Router, type IRouter } from "express";
import { db, moderationReportsTable, moderationBansTable, moderationLogTable } from "@workspace/db";
import { eq, and, or, gt, isNull } from "drizzle-orm";
import { resolveSession } from "../lib/sessionAuth.js";
import { logger } from "../lib/logger.js";
import { filterText } from "../services/textFilter.js";
import { checkLinks } from "../services/linkFilter.js";

const router: IRouter = Router();

/* ─── POST /moderation/check ───────────────────────────────────── */
/* Публичный (без авторизации) — только проверяет текст, не логирует */
router.post("/moderation/check", (req, res): void => {
  try {
    const { text } = req.body as { text?: string };
    if (!text || typeof text !== "string") { res.json({ blocked: false }); return; }

    const textResult = filterText(text);
    if (textResult.blocked) {
      res.status(451).json({
        blocked:  true,
        category: textResult.category,
        severity: textResult.severity,
      });
      return;
    }
    const linkResult = checkLinks(text);
    if (linkResult.blocked) {
      res.status(451).json({
        blocked:  true,
        category: "fraud",
        severity: "medium",
      });
      return;
    }
    res.json({ blocked: false });
  } catch (err) {
    logger.error({ err }, "moderation/check error");
    res.json({ blocked: false }); /* при сбое — не мешаем пользователям */
  }
});

/* ─── POST /moderation/report ──────────────────────────────────── */
router.post("/moderation/report", async (req, res): Promise<void> => {
  try {
    const sessionToken = req.cookies?.session_token ?? (req.headers["x-session-token"] as string);
    const userHash = sessionToken ? await resolveSession(sessionToken) : null;

    const {
      contentType,  /* 'post' | 'comment' | 'message' | 'profile' | 'broadcast' */
      contentId,
      contentText,
      category,     /* опционально — пользователь указывает категорию */
      reason,       /* свободный текст (до 500 символов) */
    } = req.body as Record<string, string>;

    if (!contentType || !contentId) {
      res.status(400).json({ error: "contentType and contentId are required" });
      return;
    }

    const VALID_TYPES = ["post", "comment", "message", "profile", "broadcast", "product", "live"];
    if (!VALID_TYPES.includes(contentType)) {
      res.status(400).json({ error: "invalid contentType" });
      return;
    }

    await db.insert(moderationReportsTable).values({
      reporterHash:  userHash ?? null,
      contentType,
      contentId,
      contentText:   contentText?.slice(0, 1000) ?? null,
      category:      category ?? null,
      reason:        reason?.slice(0, 500) ?? null,
      status:        "pending",
    });

    logger.info({ contentType, contentId, category, userHash }, "moderation report submitted");
    res.json({ ok: true, message: "Жалоба принята. Наша команда рассмотрит её в ближайшее время." });
  } catch (err) {
    logger.error({ err }, "moderation/report error");
    res.status(500).json({ error: "server_error" });
  }
});

/* ─── GET /moderation/status?session=xxx ──────────────────────── */
router.get("/moderation/status", async (req, res): Promise<void> => {
  try {
    const sessionToken = req.cookies?.session_token ?? (req.headers["x-session-token"] as string)
      ?? (req.query.session as string);
    if (!sessionToken) { res.json({ banned: false }); return; }

    const userHash = await resolveSession(sessionToken);
    if (!userHash) { res.json({ banned: false }); return; }

    const now = new Date();
    const bans = await db.select().from(moderationBansTable).where(
      and(
        eq(moderationBansTable.userHash, userHash),
        eq(moderationBansTable.active, true),
        or(isNull(moderationBansTable.expiresAt), gt(moderationBansTable.expiresAt, now))
      )
    ).limit(1);

    if (bans.length === 0) { res.json({ banned: false }); return; }

    const ban = bans[0];
    res.json({
      banned:    true,
      reason:    ban.reason,
      category:  ban.category,
      expiresAt: ban.expiresAt?.toISOString() ?? null,
    });
  } catch (err) {
    logger.error({ err }, "moderation/status error");
    res.json({ banned: false });
  }
});

/* ─── GET /moderation/log (внутренний, без авторизации по ключу — для дашборда) */
router.get("/moderation/log", async (req, res): Promise<void> => {
  const adminKey = req.headers["x-admin-key"];
  if (!adminKey || adminKey !== process.env.MODERATION_ADMIN_KEY) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const rows = await db.select().from(moderationLogTable)
      .orderBy(moderationLogTable.createdAt).limit(200);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "moderation/log error");
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
