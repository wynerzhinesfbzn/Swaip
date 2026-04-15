import { Router, type IRouter } from "express";
import { db, accountsTable, broadcastsTable, broadcastReactionsTable, broadcastCommentsTable, commentReactionsTable } from "@workspace/db";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import { requireSession, resolveSession, getSessionToken } from "../lib/sessionAuth.js";
import { contentFilter } from "../middlewares/contentFilter.js";

const router: IRouter = Router();

function parseDocUrls(raw: string | null | undefined) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function getField(data: Record<string, unknown>, key: string): string {
  const raw = data[key];
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); return typeof p === 'string' ? p : ''; } catch { return raw; }
  }
  return '';
}

async function getAuthorInfo(hash: string, mode: string) {
  const rows = await db.select().from(accountsTable).where(eq(accountsTable.hash, hash)).limit(1);
  if (!rows.length) return { name: 'Пользователь', avatar: '', handle: '' };
  const data = (rows[0].data as Record<string, unknown>) || {};
  if (mode === 'scene') {
    return {
      name:   getField(data, 'scene_artistName') || 'Артист',
      avatar: getField(data, 'scene_avatarUrl'),
      handle: getField(data, 'scene_handle'),
    };
  }
  if (mode === 'krug') {
    return {
      name:   getField(data, 'krug_displayName') || getField(data, 'pro_displayName') || getField(data, 'pro_fullName') || 'Пользователь',
      avatar: getField(data, 'krug_avatarUrl') || getField(data, 'pro_avatarUrl'),
      handle: getField(data, 'pro_handle') || '',
    };
  }
  if (mode === 'ether') {
    return {
      name:   getField(data, 'pro_displayName') || getField(data, 'pro_fullName') || 'Пользователь',
      avatar: getField(data, 'pro_avatarUrl'),
      handle: getField(data, 'pro_handle') || '',
    };
  }
  return {
    name:   getField(data, 'pro_displayName') || getField(data, 'pro_fullName') || 'Пользователь',
    avatar: getField(data, 'pro_avatarUrl'),
    handle: getField(data, 'pro_handle') || '',
  };
}

/* ── GET /api/broadcasts?author=hash&authorMode=pro&limit=30&offset=0 ── */
router.get("/broadcasts", async (req, res) => {
  try {
    const authorFilter     = typeof req.query.author     === 'string' ? req.query.author     : null;
    const authorModeFilter = typeof req.query.authorMode === 'string' ? req.query.authorMode : null;
    const limit  = Math.min(parseInt(req.query.limit  as string) || 30, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const token = getSessionToken(req);
    const userHash = token ? await resolveSession(token) : null;

    const rows = await (() => {
      if (authorFilter && authorModeFilter) {
        return db.select().from(broadcastsTable)
          .where(and(eq(broadcastsTable.authorHash, authorFilter), eq(broadcastsTable.authorMode, authorModeFilter)))
          .orderBy(desc(broadcastsTable.createdAt)).limit(limit).offset(offset);
      }
      if (authorFilter) {
        return db.select().from(broadcastsTable)
          .where(eq(broadcastsTable.authorHash, authorFilter))
          .orderBy(desc(broadcastsTable.createdAt)).limit(limit).offset(offset);
      }
      return db.select().from(broadcastsTable)
        .orderBy(desc(broadcastsTable.createdAt)).limit(limit).offset(offset);
    })();

    const includeComments = req.query.include === 'comments';
    const ids = rows.map(r => r.id);

    /* ── Батчевые запросы для всех постов (вместо N+1) ── */
    const [allReactions, allCmtCounts, allMyReactions] = await Promise.all([
      ids.length > 0
        ? db.select({ broadcastId: broadcastReactionsTable.broadcastId, emoji: broadcastReactionsTable.emoji, count: sql<number>`count(*)::int` })
            .from(broadcastReactionsTable).where(inArray(broadcastReactionsTable.broadcastId, ids))
            .groupBy(broadcastReactionsTable.broadcastId, broadcastReactionsTable.emoji)
        : Promise.resolve([]),
      ids.length > 0
        ? db.select({ broadcastId: broadcastCommentsTable.broadcastId, count: sql<number>`count(*)::int` })
            .from(broadcastCommentsTable).where(inArray(broadcastCommentsTable.broadcastId, ids))
            .groupBy(broadcastCommentsTable.broadcastId)
        : Promise.resolve([]),
      userHash && ids.length > 0
        ? db.select({ broadcastId: broadcastReactionsTable.broadcastId, emoji: broadcastReactionsTable.emoji })
            .from(broadcastReactionsTable)
            .where(and(inArray(broadcastReactionsTable.broadcastId, ids), eq(broadcastReactionsTable.userHash, userHash)))
        : Promise.resolve([]),
    ]);

    /* ── Батч авторов ── */
    const authorHashes = [...new Set(rows.map(r => r.authorHash))];
    const authorRows = authorHashes.length > 0
      ? await db.select({ hash: accountsTable.hash, data: accountsTable.data })
          .from(accountsTable).where(inArray(accountsTable.hash, authorHashes))
      : [];
    const authorDataMap = new Map(authorRows.map(a => [a.hash, (a.data as Record<string, unknown>) || {}]));

    function resolveAuthor(hash: string, mode: string) {
      const d = authorDataMap.get(hash) || {};
      if (mode === 'scene') return { name: getField(d,'scene_artistName')||'Артист', avatar: getField(d,'scene_avatarUrl'), handle: getField(d,'scene_handle') };
      if (mode === 'krug')  return { name: getField(d,'krug_displayName')||getField(d,'pro_displayName')||'Пользователь', avatar: getField(d,'krug_avatarUrl')||getField(d,'pro_avatarUrl'), handle: '' };
      if (mode === 'ether') return { name: getField(d,'pro_displayName')||getField(d,'pro_fullName')||'Пользователь', avatar: getField(d,'pro_avatarUrl'), handle: getField(d,'pro_handle')||'' };
      return { name: getField(d,'pro_displayName')||getField(d,'pro_fullName')||'Пользователь', avatar: getField(d,'pro_avatarUrl'), handle: getField(d,'pro_handle')||'' };
    }

    /* Индексы для быстрого lookup */
    const reactByPost   = new Map<number, {emoji:string;count:number}[]>();
    for (const r of allReactions) {
      if (!reactByPost.has(r.broadcastId)) reactByPost.set(r.broadcastId, []);
      reactByPost.get(r.broadcastId)!.push({ emoji: r.emoji, count: r.count });
    }
    const cntByPost     = new Map(allCmtCounts.map(c => [c.broadcastId, c.count]));
    const myReactByPost = new Map<number, string[]>();
    for (const r of allMyReactions) {
      if (!myReactByPost.has(r.broadcastId)) myReactByPost.set(r.broadcastId, []);
      myReactByPost.get(r.broadcastId)!.push(r.emoji);
    }

    /* ── Батч комментариев (только если ?include=comments) ── */
    let cmtsByPost = new Map<number, any[]>();
    if (includeComments && ids.length > 0) {
      const allComments = await db.select().from(broadcastCommentsTable)
        .where(inArray(broadcastCommentsTable.broadcastId, ids))
        .orderBy(broadcastCommentsTable.createdAt);

      const cmtIds = allComments.map(c => c.id);
      const [allCmtReacts, myAllCmtReacts, cmtAuthorRows] = await Promise.all([
        cmtIds.length > 0
          ? db.select({ commentId: commentReactionsTable.commentId, emoji: commentReactionsTable.emoji, count: sql<number>`count(*)::int` })
              .from(commentReactionsTable).where(inArray(commentReactionsTable.commentId, cmtIds))
              .groupBy(commentReactionsTable.commentId, commentReactionsTable.emoji)
          : Promise.resolve([]),
        userHash && cmtIds.length > 0
          ? db.select({ commentId: commentReactionsTable.commentId, emoji: commentReactionsTable.emoji })
              .from(commentReactionsTable)
              .where(and(inArray(commentReactionsTable.commentId, cmtIds), eq(commentReactionsTable.userHash, userHash)))
          : Promise.resolve([]),
        ((): Promise<any[]> => {
          const cmtHashes = [...new Set(allComments.map(c => c.authorHash))].filter(h => !authorDataMap.has(h));
          return cmtHashes.length > 0
            ? db.select({ hash: accountsTable.hash, data: accountsTable.data })
                .from(accountsTable).where(inArray(accountsTable.hash, cmtHashes))
            : Promise.resolve([]);
        })(),
      ]);

      for (const a of cmtAuthorRows) authorDataMap.set(a.hash, (a.data as Record<string, unknown>) || {});

      const cmtReactById = new Map<number, {emoji:string;count:number}[]>();
      for (const r of allCmtReacts) {
        if (!cmtReactById.has(r.commentId)) cmtReactById.set(r.commentId, []);
        cmtReactById.get(r.commentId)!.push({ emoji: r.emoji, count: r.count });
      }
      const myCmtReactById = new Map<number, string[]>();
      for (const r of myAllCmtReacts) {
        if (!myCmtReactById.has(r.commentId)) myCmtReactById.set(r.commentId, []);
        myCmtReactById.get(r.commentId)!.push(r.emoji);
      }

      for (const c of allComments) {
        if (!cmtsByPost.has(c.broadcastId)) cmtsByPost.set(c.broadcastId, []);
        cmtsByPost.get(c.broadcastId)!.push({
          ...c,
          author: resolveAuthor(c.authorHash, c.authorMode || 'pro'),
          reactions: cmtReactById.get(c.id) || [],
          myReactions: myCmtReactById.get(c.id) || [],
        });
      }
    }

    const result = rows.map(b => ({
      ...b,
      docUrls: parseDocUrls(b.docUrls),
      reactions:    reactByPost.get(b.id)   || [],
      myReactions:  myReactByPost.get(b.id) || [],
      commentCount: cntByPost.get(b.id)     ?? 0,
      author:       resolveAuthor(b.authorHash, b.authorMode),
      ...(includeComments ? { comments: cmtsByPost.get(b.id) || [] } : {}),
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'internal' });
  }
});

/* ── GET /api/broadcasts/:id ── (optional session for myReactions) */
router.get("/broadcasts/:id", async (req, res) => {
  try {
    const id = parseInt(req.params['id'] as string);
    const token = getSessionToken(req);
    const userHash = token ? await resolveSession(token) : null;

    const rows = await db.select().from(broadcastsTable).where(eq(broadcastsTable.id, id)).limit(1);
    if (!rows.length) { res.status(404).json({ error: 'not found' }); return; }
    const b = rows[0];

    /* ?noview=1 используется при синк-опросах (fetchProAll каждые 3с) — не считать как просмотр */
    const noView = req.query['noview'] === '1';
    if (!noView) {
      await db.update(broadcastsTable).set({ viewCount: sql`${broadcastsTable.viewCount} + 1` }).where(eq(broadcastsTable.id, id));
    }

    const [reactions, comments, authorInfo, myReactions] = await Promise.all([
      db.select({ emoji: broadcastReactionsTable.emoji, count: sql<number>`count(*)::int` })
        .from(broadcastReactionsTable)
        .where(eq(broadcastReactionsTable.broadcastId, id))
        .groupBy(broadcastReactionsTable.emoji),
      db.select().from(broadcastCommentsTable)
        .where(eq(broadcastCommentsTable.broadcastId, id))
        .orderBy(broadcastCommentsTable.createdAt),
      getAuthorInfo(b.authorHash, b.authorMode),
      userHash
        ? db.select({ emoji: broadcastReactionsTable.emoji }).from(broadcastReactionsTable)
            .where(and(eq(broadcastReactionsTable.broadcastId, id), eq(broadcastReactionsTable.userHash, userHash)))
        : Promise.resolve([]),
    ]);

    const enrichedComments = await Promise.all(comments.map(async (c) => {
      const [cAuthor, cReactions, myCommentReactions] = await Promise.all([
        getAuthorInfo(c.authorHash, 'auto'),
        db.select({ emoji: commentReactionsTable.emoji, count: sql<number>`count(*)::int` })
          .from(commentReactionsTable)
          .where(eq(commentReactionsTable.commentId, c.id))
          .groupBy(commentReactionsTable.emoji),
        userHash
          ? db.select({ emoji: commentReactionsTable.emoji }).from(commentReactionsTable)
              .where(and(eq(commentReactionsTable.commentId, c.id), eq(commentReactionsTable.userHash, userHash)))
          : Promise.resolve([]),
      ]);
      return {
        ...c,
        author: cAuthor,
        reactions: cReactions,
        myReactions: myCommentReactions.map(r => r.emoji),
      };
    }));

    res.json({
      ...b,
      docUrls: parseDocUrls(b.docUrls),
      viewCount: (b.viewCount ?? 0) + 1,
      reactions: reactions.map(r => ({ emoji: r.emoji, count: r.count })),
      myReactions: myReactions.map(r => r.emoji),
      comments: enrichedComments,
      author: authorInfo,
    });
  } catch (err) {
    res.status(500).json({ error: 'internal' });
  }
});

/* ── POST /api/broadcasts ── (requires session) */
router.post("/broadcasts", requireSession, contentFilter("broadcast", ["content"]), async (req, res) => {
  try {
    const userHash = (req as any).userHash as string;
    const { content, authorMode, audioUrl, imageUrl, videoUrl, docUrls } = req.body as { content?: string; authorMode: string; audioUrl?: string; imageUrl?: string; videoUrl?: string; docUrls?: Array<{url:string;name:string;size:number;mime:string}> };
    const hasDocUrls = docUrls && docUrls.length > 0;
    if (!content?.trim() && !audioUrl && !imageUrl && !videoUrl && !hasDocUrls) { res.status(400).json({ error: 'content required' }); return; }
    if (!['pro', 'scene', 'krug', 'ether'].includes(authorMode)) { res.status(400).json({ error: 'invalid mode' }); return; }

    const rows = await db.insert(broadcastsTable).values({
      authorHash: userHash,
      authorMode,
      content: content?.trim() || '',
      audioUrl: audioUrl || null,
      imageUrl: imageUrl || null,
      videoUrl: videoUrl || null,
      docUrls: hasDocUrls ? JSON.stringify(docUrls) : null,
    }).returning();

    const b = rows[0];
    const authorInfo = await getAuthorInfo(userHash, authorMode);
    res.json({ ...b, docUrls: b.docUrls ? JSON.parse(b.docUrls) : null, reactions: [], commentCount: 0, myReactions: [], author: authorInfo });
  } catch (err) {
    res.status(500).json({ error: 'internal' });
  }
});

/* ── DELETE /api/broadcasts/:id ── (requires session) */
router.delete("/broadcasts/:id", requireSession, async (req, res) => {
  try {
    const id = parseInt(req.params['id'] as string);
    const userHash = (req as any).userHash as string;

    const rows = await db.select().from(broadcastsTable).where(eq(broadcastsTable.id, id)).limit(1);
    if (!rows.length) { res.status(404).json({ error: 'not found' }); return; }
    if (rows[0].authorHash !== userHash) { res.status(403).json({ error: 'forbidden' }); return; }

    await db.delete(broadcastsTable).where(eq(broadcastsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'internal' });
  }
});

/* ── POST /api/broadcasts/:id/react ── (requires session) */
router.post("/broadcasts/:id/react", requireSession, async (req, res) => {
  try {
    const id = parseInt(req.params['id'] as string);
    const userHash = (req as any).userHash as string;
    const { emoji } = req.body as { emoji: string };
    if (!emoji) { res.status(400).json({ error: 'emoji required' }); return; }

    const existing = await db.select().from(broadcastReactionsTable)
      .where(and(eq(broadcastReactionsTable.broadcastId, id), eq(broadcastReactionsTable.userHash, userHash), eq(broadcastReactionsTable.emoji, emoji)))
      .limit(1);

    if (existing.length) {
      await db.delete(broadcastReactionsTable)
        .where(and(eq(broadcastReactionsTable.broadcastId, id), eq(broadcastReactionsTable.userHash, userHash), eq(broadcastReactionsTable.emoji, emoji)));
    } else {
      await db.insert(broadcastReactionsTable).values({ broadcastId: id, userHash, emoji });
    }

    const reactions = await db.select({ emoji: broadcastReactionsTable.emoji, count: sql<number>`count(*)::int` })
      .from(broadcastReactionsTable).where(eq(broadcastReactionsTable.broadcastId, id)).groupBy(broadcastReactionsTable.emoji);
    const myReactions = await db.select({ emoji: broadcastReactionsTable.emoji }).from(broadcastReactionsTable)
      .where(and(eq(broadcastReactionsTable.broadcastId, id), eq(broadcastReactionsTable.userHash, userHash)));

    res.json({ reactions, myReactions: myReactions.map(r => r.emoji) });
  } catch (err) {
    res.status(500).json({ error: 'internal' });
  }
});

/* ── POST /api/broadcasts/:id/comments ── (requires session) */
router.post("/broadcasts/:id/comments", requireSession, contentFilter("broadcast_comment", ["content"]), async (req, res) => {
  try {
    const broadcastId = parseInt(req.params['id'] as string);
    const userHash = (req as any).userHash as string;

    const { content, audioUrl, parentId } = req.body as { content?: string; audioUrl?: string; parentId?: number };
    if (!content?.trim() && !audioUrl) { res.status(400).json({ error: 'content or audioUrl required' }); return; }

    const rows = await db.insert(broadcastCommentsTable).values({
      broadcastId,
      authorHash: userHash,
      content: content?.trim() || '',
      audioUrl: audioUrl || null,
      parentId: parentId ?? null,
    }).returning();

    const authorInfo = await getAuthorInfo(userHash, 'auto');
    res.json({ ...rows[0], author: authorInfo, reactions: [], myReactions: [] });
  } catch (err) {
    res.status(500).json({ error: 'internal' });
  }
});

/* ── POST /api/broadcasts/:id/comments/:commentId/react ── (requires session) */
router.post("/broadcasts/:id/comments/:commentId/react", requireSession, async (req, res) => {
  try {
    const commentId = parseInt(req.params['commentId'] as string);
    const userHash = (req as any).userHash as string;
    const { emoji } = req.body as { emoji: string };
    if (!emoji) { res.status(400).json({ error: 'emoji required' }); return; }

    const existing = await db.select().from(commentReactionsTable)
      .where(and(eq(commentReactionsTable.commentId, commentId), eq(commentReactionsTable.userHash, userHash), eq(commentReactionsTable.emoji, emoji)))
      .limit(1);

    if (existing.length) {
      await db.delete(commentReactionsTable)
        .where(and(eq(commentReactionsTable.commentId, commentId), eq(commentReactionsTable.userHash, userHash), eq(commentReactionsTable.emoji, emoji)));
    } else {
      await db.insert(commentReactionsTable).values({ commentId, userHash, emoji });
    }

    const reactions = await db.select({ emoji: commentReactionsTable.emoji, count: sql<number>`count(*)::int` })
      .from(commentReactionsTable).where(eq(commentReactionsTable.commentId, commentId)).groupBy(commentReactionsTable.emoji);
    const myReactions = await db.select({ emoji: commentReactionsTable.emoji }).from(commentReactionsTable)
      .where(and(eq(commentReactionsTable.commentId, commentId), eq(commentReactionsTable.userHash, userHash)));

    res.json({ reactions, myReactions: myReactions.map(r => r.emoji) });
  } catch (err) {
    res.status(500).json({ error: 'internal' });
  }
});

/* ── POST /api/broadcasts/:id/seed-bots ── (idempotent, no auth) */
/* Фронтенд передаёт детерминированные бот-реакции и бот-комментарии.   */
/* Эндпоинт идемпотентный: повторный вызов ничего не меняет.            */
router.post("/broadcasts/:id/seed-bots", async (req, res) => {
  try {
    const id = parseInt(req.params['id'] as string);
    if (isNaN(id)) { res.status(400).json({ error: 'invalid id' }); return; }

    /* Идемпотентность: если уже есть бот-реакции — ничего не делаем */
    const already = await db.select({ id: broadcastReactionsTable.id })
      .from(broadcastReactionsTable)
      .where(and(
        eq(broadcastReactionsTable.broadcastId, id),
        sql`${broadcastReactionsTable.userHash} LIKE 'bot_%'`
      ))
      .limit(1);

    if (already.length > 0) { res.json({ seeded: false, already: true }); return; }

    const { reactions, comments } = req.body as {
      reactions?: Array<{ emoji: string; count: number }>;
      comments?: Array<{ botHash: string; content: string }>;
    };

    /* Вставляем бот-реакции: по одной строке на каждый лайк */
    if (reactions && Array.isArray(reactions)) {
      for (const r of reactions) {
        const count = Math.min(r.count || 1, 30);
        for (let i = 0; i < count; i++) {
          await db.insert(broadcastReactionsTable)
            .values({ broadcastId: id, userHash: `bot_${r.emoji.codePointAt(0)}_${i}`, emoji: r.emoji })
            .onConflictDoNothing();
        }
      }
    }

    /* Вставляем бот-комментарии */
    if (comments && Array.isArray(comments)) {
      for (const c of comments) {
        await db.insert(broadcastCommentsTable)
          .values({ broadcastId: id, authorHash: c.botHash, content: c.content });
      }
    }

    res.json({ seeded: true });
  } catch (err) {
    console.error('[seed-bots]', err);
    res.status(500).json({ error: 'internal' });
  }
});

export default router;
