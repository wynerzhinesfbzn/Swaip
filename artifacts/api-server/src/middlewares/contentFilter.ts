/* ═══════════════════════════════════════════════════════════════════
   SWAIP — Express middleware для автоматической фильтрации контента
   Применяется к: комментарии, сообщения, посты, описания профилей,
                  названия эфиров, товары в магазине
═══════════════════════════════════════════════════════════════════ */
import type { Request, Response, NextFunction } from "express";
import { filterFields } from "../services/textFilter.js";
import { checkLinks } from "../services/linkFilter.js";
import { db, moderationLogTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

/* Режим работы. WARN = логировать, но не блокировать (для тестов) */
const MODE: "block" | "warn" = (process.env.MODERATION_MODE as "block" | "warn") ?? "block";

/* ─── Вспомогательные ──────────────────────────────────────────── */

function extractStrings(body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!body || typeof body !== "object") return out;
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "object" && v !== null) {
      /* Один уровень вложенности — например, data: { bio: "..." } */
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (typeof v2 === "string") out[`${k}.${k2}`] = v2;
      }
    }
  }
  return out;
}

async function logViolation(
  req: Request,
  category: string,
  rule: string | null,
  action: string,
  contentType: string,
) {
  try {
    const userHash = (req as Request & { userHash?: string }).userHash ?? null;
    const contentId = (req.params?.postId ?? req.params?.id ?? null) as string | null;
    const contentText = JSON.stringify(req.body)?.slice(0, 500) ?? null;
    await db.insert(moderationLogTable).values({
      userHash,
      contentType,
      contentId,
      contentText,
      category,
      matchedRule: rule,
      action,
      triggeredBy: "auto",
    });
  } catch (e) {
    logger.error({ err: e }, "moderation log insert failed");
  }
}

/* ─── Фабрика middleware ───────────────────────────────────────── */

/**
 * Создаёт middleware для фильтрации текстового контента.
 * @param contentType  — тип контента для логгирования ('comment' | 'message' | 'post' | 'profile' | 'broadcast')
 * @param fieldNames   — поля body для проверки; если не указаны — проверяются все строковые поля
 */
export function contentFilter(contentType: string, fieldNames?: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const allStrings = extractStrings(req.body);
      const target: Record<string, string> = fieldNames
        ? Object.fromEntries(Object.entries(allStrings).filter(([k]) => fieldNames.some(f => k === f || k.endsWith(`.${f}`))))
        : allStrings;

      /* ── Текстовый фильтр ── */
      const textResult = filterFields(target);
      if (textResult.blocked) {
        await logViolation(req, textResult.category!, textResult.rule, MODE === "block" ? "blocked" : "warned", contentType);

        if (MODE === "block") {
          logger.warn({ category: textResult.category, rule: textResult.rule, contentType }, "content blocked");
          res.status(451).json({
            error: "content_blocked",
            category: textResult.category,
            severity: textResult.severity,
          });
          return;
        }
        logger.warn({ category: textResult.category, rule: textResult.rule, contentType }, "content flagged (warn-only mode)");
      }

      /* ── Фильтр ссылок ── */
      const allText = Object.values(target).join(" ");
      const linkResult = checkLinks(allText);
      if (linkResult.blocked) {
        await logViolation(req, "fraud", linkResult.reason, MODE === "block" ? "blocked" : "warned", contentType);

        if (MODE === "block") {
          logger.warn({ url: linkResult.blockedUrl, reason: linkResult.reason, contentType }, "link blocked");
          res.status(451).json({
            error: "link_blocked",
            category: "fraud",
            reason: linkResult.reason,
          });
          return;
        }
      }

      next();
    } catch (err) {
      logger.error({ err }, "contentFilter middleware error");
      next(); /* При сбое фильтра — пропускаем, не мешаем пользователям */
    }
  };
}
