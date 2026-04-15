import { Router, type IRouter } from "express";
import { db, reviewsTable, accountsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireSession, resolveSession, getSessionToken } from "../lib/sessionAuth.js";

const router: IRouter = Router();

/* ──────────────────────────────────────────────────
 * GET /api/accounts/:hash/reviews
 * Публичный — читать может кто угодно
 * ────────────────────────────────────────────────── */
router.get("/accounts/:hash/reviews", async (req, res) => {
  const { hash } = req.params;
  try {
    const rows = await db
      .select()
      .from(reviewsTable)
      .where(eq(reviewsTable.targetHash, hash))
      .orderBy(desc(reviewsTable.createdAt));

    /* Смотрим, написал ли текущий пользователь уже отзыв */
    const token = getSessionToken(req);
    let myReviewId: number | null = null;
    if (token) {
      const authorHash = await resolveSession(token);
      if (authorHash) {
        const mine = rows.find(r => r.authorHash === authorHash);
        if (mine) myReviewId = mine.id;
      }
    }

    return res.json({ reviews: rows, myReviewId });
  } catch (err) {
    return res.status(500).json({ error: "Ошибка сервера" });
  }
});

/* ──────────────────────────────────────────────────
 * POST /api/accounts/:hash/reviews
 * Требует авторизации.
 * Защиты:
 *   1. Нельзя оставлять самому себе
 *   2. Один отзыв на аккаунт (unique constraint в БД)
 *   3. Только авторизованные пользователи
 *   4. Аккаунт автора должен существовать ≥ 3 дней
 *   5. Профиль автора должен быть заполнен (имя / ник)
 * ────────────────────────────────────────────────── */
router.post("/accounts/:hash/reviews", requireSession, async (req, res) => {
  const { hash: targetHash } = req.params;
  const authorHash: string = (req as any).userHash;

  /* 1. Нельзя оставить отзыв самому себе */
  if (authorHash === targetHash) {
    return res.status(400).json({ error: "Нельзя оставить отзыв самому себе" });
  }

  /* 2. Профиль-получатель должен существовать */
  const target = await db.select({ hash: accountsTable.hash })
    .from(accountsTable)
    .where(eq(accountsTable.hash, targetHash))
    .limit(1);
  if (!target.length) {
    return res.status(404).json({ error: "Профиль не найден" });
  }

  /* 4 & 5. Проверяем автора: возраст аккаунта и заполненность профиля */
  const authorRows = await db.select({ createdAt: accountsTable.createdAt, data: accountsTable.data })
    .from(accountsTable)
    .where(eq(accountsTable.hash, authorHash))
    .limit(1);

  if (!authorRows.length) {
    return res.status(403).json({ error: "Аккаунт не найден" });
  }

  const author = authorRows[0];

  /* 4. Аккаунт должен существовать минимум 3 дня */
  const MIN_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 дня
  const accountAge = Date.now() - new Date(author.createdAt ?? 0).getTime();
  if (accountAge < MIN_AGE_MS) {
    const daysLeft = Math.ceil((MIN_AGE_MS - accountAge) / (24 * 60 * 60 * 1000));
    return res.status(403).json({
      error: `Отзывы можно оставлять только через 3 дня после регистрации. Осталось: ${daysLeft} ${daysLeft === 1 ? "день" : daysLeft < 5 ? "дня" : "дней"}`,
      code: "ACCOUNT_TOO_NEW",
    });
  }

  /* 5. У автора должно быть заполнено имя или никнейм */
  const d = (author.data as Record<string, unknown>) ?? {};
  const parse = (v: unknown): string => {
    if (!v) return "";
    if (typeof v === "string") { try { const p = JSON.parse(v); return typeof p === "string" ? p : ""; } catch { return v; } }
    return "";
  };
  const authorName = parse(d["pro_displayName"]) || parse(d["pro_fullName"]) ||
                     parse(d["scene_artistName"]) || parse(d["krug_displayName"]);
  if (!authorName.trim()) {
    return res.status(403).json({
      error: "Заполните имя или никнейм в вашем профиле, прежде чем оставлять отзывы",
      code: "PROFILE_INCOMPLETE",
    });
  }

  const { name, rating, text } = req.body as { name?: string; rating?: number; text?: string };

  if (!name || typeof name !== "string" || name.trim().length < 2) {
    return res.status(400).json({ error: "Укажите ваше имя (минимум 2 символа)" });
  }
  if (!text || typeof text !== "string" || text.trim().length < 10) {
    return res.status(400).json({ error: "Текст отзыва слишком короткий (минимум 10 символов)" });
  }
  if (!rating || typeof rating !== "number" || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "Оценка должна быть от 1 до 5" });
  }

  try {
    const [inserted] = await db.insert(reviewsTable).values({
      targetHash,
      authorHash,
      authorName: name.trim().slice(0, 64),
      rating: Math.round(rating),
      text: text.trim().slice(0, 1500),
    }).returning();

    return res.status(201).json({ review: inserted });
  } catch (err: any) {
    /* Unique constraint violation = уже есть отзыв */
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Вы уже оставили отзыв этому пользователю" });
    }
    return res.status(500).json({ error: "Ошибка сервера" });
  }
});

/* ──────────────────────────────────────────────────
 * DELETE /api/accounts/:hash/reviews/:id
 * Удалить может:
 *   - Хозяин страницы (targetHash === authorizedHash)
 *   - Автор отзыва (authorHash === authorizedHash)
 * ────────────────────────────────────────────────── */
router.delete("/accounts/:hash/reviews/:id", requireSession, async (req, res) => {
  const { hash: targetHash, id } = req.params;
  const callerHash: string = (req as any).userHash;
  const reviewId = Number(id);

  if (isNaN(reviewId)) return res.status(400).json({ error: "Неверный ID" });

  const rows = await db.select()
    .from(reviewsTable)
    .where(and(eq(reviewsTable.id, reviewId), eq(reviewsTable.targetHash, targetHash)))
    .limit(1);

  if (!rows.length) return res.status(404).json({ error: "Отзыв не найден" });

  const review = rows[0];
  if (review.authorHash !== callerHash && targetHash !== callerHash) {
    return res.status(403).json({ error: "Нет доступа" });
  }

  await db.delete(reviewsTable).where(eq(reviewsTable.id, reviewId));
  return res.json({ ok: true });
});

export default router;
