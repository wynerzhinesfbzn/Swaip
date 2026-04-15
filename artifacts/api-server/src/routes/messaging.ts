import { Router, type IRouter } from "express";
import { db, accountsTable, conversationsTable, messagesTable, followsTable, conversationParticipantsTable } from "@workspace/db";
import { eq, and, or, desc, sql, inArray } from "drizzle-orm";
import { requireSession, resolveSession, getSessionToken } from "../lib/sessionAuth.js";
import { encryptMessage, decryptMessage } from "../lib/messageCrypto.js";
import { contentFilter } from "../middlewares/contentFilter.js";

const router: IRouter = Router();

/* ── Rate limiting: 30 сообщений/мин на пользователя ── */
const msgRateMap = new Map<string, { count: number; resetAt: number }>();
function msgRateLimit(userHash: string, max = 30): boolean {
  const now = Date.now();
  const entry = msgRateMap.get(userHash);
  if (!entry || entry.resetAt < now) { msgRateMap.set(userHash, { count: 1, resetAt: now + 60_000 }); return true; }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of msgRateMap) if (v.resetAt < now) msgRateMap.delete(k); }, 5 * 60_000);

const MAX_MSG_LENGTH = 10_000;

async function getAuthorInfo(hash: string) {
  if (!hash) return { name: 'Пользователь', avatar: '', handle: '' };
  try {
    const rows = await db.select().from(accountsTable).where(eq(accountsTable.hash, hash)).limit(1);
    if (!rows.length) return { name: 'Пользователь', avatar: '', handle: '' };
    const data = (rows[0].data as Record<string, unknown>) ?? {};
    const parse = (v: unknown) => {
      if (!v) return '';
      if (typeof v === 'string') { try { const p = JSON.parse(v); return typeof p === 'string' ? p : ''; } catch { return v; } }
      return '';
    };
    const name = parse(data['pro_displayName']) || parse(data['scene_artistName']) || 'Пользователь';
    const avatar = parse(data['pro_avatarUrl']) || parse(data['scene_avatarUrl']) || '';
    const handle = parse(data['pro_fullName']) || parse(data['scene_handle']) || '';
    return { name, avatar, handle };
  } catch { return { name: 'Пользователь', avatar: '', handle: '' }; }
}

async function canAccess(convId: number, userHash: string): Promise<boolean> {
  const conv = await db.select().from(conversationsTable).where(eq(conversationsTable.id, convId)).limit(1);
  if (!conv.length) return false;
  const c = conv[0];
  if (c.type === 'dm') return c.participant1 === userHash || c.participant2 === userHash;
  const p = await db.select().from(conversationParticipantsTable)
    .where(and(eq(conversationParticipantsTable.conversationId, convId), eq(conversationParticipantsTable.userHash, userHash))).limit(1);
  return p.length > 0;
}

async function getParticipantHashes(conv: { id: number; type: string; participant1: string; participant2: string }): Promise<string[]> {
  if (conv.type === 'dm') return [conv.participant1, conv.participant2];
  const rows = await db.select().from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.conversationId, conv.id));
  return rows.map(r => r.userHash);
}

/* ─────────────────────────── FOLLOWS ─────────────────────────── */

router.get("/follows/:hash", async (req, res) => {
  const { hash } = req.params;
  /* Optional session — needed for isFollowing check */
  const token = getSessionToken(req);
  const me = token ? await resolveSession(token) : null;

  try {
    const [followers, following, myFollow, theirFollow] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.followingHash, hash)),
      db.select({ count: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.followerHash, hash)),
      me ? db.select().from(followsTable).where(and(eq(followsTable.followerHash, me), eq(followsTable.followingHash, hash))).limit(1) : Promise.resolve([]),
      me ? db.select().from(followsTable).where(and(eq(followsTable.followerHash, hash), eq(followsTable.followingHash, me))).limit(1) : Promise.resolve([]),
    ]);
    const isFollowing = myFollow.length > 0;
    return res.json({
      followers: followers[0]?.count ?? 0,
      following: following[0]?.count ?? 0,
      isFollowing,
      isMutual: isFollowing && theirFollow.length > 0,
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/follows", requireSession, async (req, res) => {
  const me = (req as any).userHash as string;
  const { targetHash } = req.body;
  if (!targetHash || targetHash === me) return res.status(400).json({ error: "Bad request" });
  try {
    const existing = await db.select().from(followsTable)
      .where(and(eq(followsTable.followerHash, me), eq(followsTable.followingHash, targetHash))).limit(1);
    if (existing.length > 0) {
      await db.delete(followsTable)
        .where(and(eq(followsTable.followerHash, me), eq(followsTable.followingHash, targetHash)));
      return res.json({ isFollowing: false });
    } else {
      await db.insert(followsTable).values({ followerHash: me, followingHash: targetHash });
      return res.json({ isFollowing: true });
    }
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
});

/* GET /follows/:hash/list?type=followers|following|friends
   Returns enriched list of users (hash + name + avatar + handle) */
router.get("/follows/:hash/list", async (req, res) => {
  const { hash } = req.params;
  const type = (req.query.type as string) || 'followers';
  try {
    let hashes: string[] = [];
    if (type === 'followers') {
      /* People who follow hash */
      const rows = await db.select({ h: followsTable.followerHash })
        .from(followsTable).where(eq(followsTable.followingHash, hash));
      hashes = rows.map(r => r.h);
    } else if (type === 'following') {
      /* People that hash follows */
      const rows = await db.select({ h: followsTable.followingHash })
        .from(followsTable).where(eq(followsTable.followerHash, hash));
      hashes = rows.map(r => r.h);
    } else if (type === 'friends') {
      /* Mutual: hash follows them AND they follow hash */
      const [following, followers] = await Promise.all([
        db.select({ h: followsTable.followingHash }).from(followsTable).where(eq(followsTable.followerHash, hash)),
        db.select({ h: followsTable.followerHash }).from(followsTable).where(eq(followsTable.followingHash, hash)),
      ]);
      const followingSet = new Set(following.map(r => r.h));
      hashes = followers.filter(r => followingSet.has(r.h)).map(r => r.h);
    }
    if (!hashes.length) return res.json({ users: [] });
    const accounts = await db.select().from(accountsTable).where(inArray(accountsTable.hash, hashes));
    const users = accounts.map(a => {
      const d = (a.data as Record<string, unknown>) ?? {};
      const parse = (v: unknown) => {
        if (!v) return '';
        if (typeof v === 'string') { try { const p = JSON.parse(v); return typeof p === 'string' ? p : ''; } catch { return v; } }
        return '';
      };
      return {
        hash: a.hash,
        name: parse(d['pro_displayName']) || parse(d['scene_artistName']) || 'Участник SWAIP',
        avatar: parse(d['pro_avatarUrl']) || parse(d['scene_avatarUrl']) || '',
        handle: parse(d['pro_fullName']) || parse(d['scene_handle']) || '',
        mode: parse(d['pro_displayName']) ? 'pro' : 'scene',
      };
    });
    return res.json({ users });
  } catch { return res.status(500).json({ error: "Server error" }); }
});

/* POST /follows/mutual  — обе стороны становятся подписчиками друг друга */
router.post("/follows/mutual", requireSession, async (req, res) => {
  const me = (req as any).userHash as string;
  const { targetHash } = req.body;
  if (!targetHash || targetHash === me) return res.status(400).json({ error: "Bad request" });
  try {
    /* me → target */
    const meToTarget = await db.select().from(followsTable)
      .where(and(eq(followsTable.followerHash, me), eq(followsTable.followingHash, targetHash))).limit(1);
    if (!meToTarget.length) await db.insert(followsTable).values({ followerHash: me, followingHash: targetHash });
    /* target → me */
    const targetToMe = await db.select().from(followsTable)
      .where(and(eq(followsTable.followerHash, targetHash), eq(followsTable.followingHash, me))).limit(1);
    if (!targetToMe.length) await db.insert(followsTable).values({ followerHash: targetHash, followingHash: me });
    return res.json({ mutual: true });
  } catch { return res.status(500).json({ error: "Server error" }); }
});

/* ─────────────────────────── CONVERSATIONS ─────────────────────────── */

router.get("/conversations", requireSession, async (req, res) => {
  const me = (req as any).userHash as string;
  try {
    const dmConvs = await db.select().from(conversationsTable)
      .where(and(
        or(eq(conversationsTable.participant1, me), eq(conversationsTable.participant2, me)),
        eq(conversationsTable.type, 'dm')
      ))
      .orderBy(desc(conversationsTable.lastMessageAt));

    const myGroupParticipations = await db.select().from(conversationParticipantsTable)
      .where(eq(conversationParticipantsTable.userHash, me));
    const groupIds = myGroupParticipations.map(p => p.conversationId);
    const groupConvs = groupIds.length > 0
      ? await db.select().from(conversationsTable)
          .where(and(inArray(conversationsTable.id, groupIds), eq(conversationsTable.type, 'group')))
          .orderBy(desc(conversationsTable.lastMessageAt))
      : [];

    const allConvs = [...dmConvs, ...groupConvs].sort(
      (a, b) => new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime()
    );

    const result = await Promise.all(allConvs.map(async c => {
      const [lastMsg, unread] = await Promise.all([
        db.select().from(messagesTable)
          .where(eq(messagesTable.conversationId, c.id))
          .orderBy(desc(messagesTable.createdAt)).limit(1),
        db.select({ count: sql<number>`count(*)::int` }).from(messagesTable)
          .where(and(
            eq(messagesTable.conversationId, c.id),
            eq(messagesTable.isRead, false),
            sql`${messagesTable.senderHash} != ${me}`
          )),
      ]);

      if (c.type === 'dm') {
        const otherHash = c.participant1 === me ? c.participant2 : c.participant1;
        const otherInfo = await getAuthorInfo(otherHash);
        return {
          id: c.id,
          type: 'dm',
          otherHash,
          otherInfo,
          name: null,
          participants: [],
          lastMessage: lastMsg[0] ? { ...lastMsg[0], content: lastMsg[0].messageType === 'system' ? lastMsg[0].content : decryptMessage(lastMsg[0].content, c.id) } : null,
          unreadCount: unread[0]?.count ?? 0,
          lastMessageAt: c.lastMessageAt,
        };
      } else {
        const participantRows = await db.select().from(conversationParticipantsTable)
          .where(eq(conversationParticipantsTable.conversationId, c.id));
        const participantHashes = participantRows.map(p => p.userHash);
        const participantInfos = await Promise.all(participantHashes.map(h => getAuthorInfo(h)));
        return {
          id: c.id,
          type: 'group',
          otherHash: '',
          otherInfo: { name: c.name ?? 'Беседа', avatar: '', handle: '' },
          name: c.name,
          participants: participantHashes.map((h, i) => ({ hash: h, info: participantInfos[i] })),
          lastMessage: lastMsg[0] ? { ...lastMsg[0], content: lastMsg[0].messageType === 'system' ? lastMsg[0].content : decryptMessage(lastMsg[0].content, c.id) } : null,
          unreadCount: unread[0]?.count ?? 0,
          lastMessageAt: c.lastMessageAt,
        };
      }
    }));

    return res.json({ conversations: result });
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/conversations", requireSession, async (req, res) => {
  const me = (req as any).userHash as string;
  const { otherHash } = req.body;
  if (!otherHash || otherHash === me) return res.status(400).json({ error: "Bad request" });

  const p1 = [me, otherHash].sort()[0];
  const p2 = [me, otherHash].sort()[1];

  try {
    const existing = await db.select().from(conversationsTable)
      .where(and(eq(conversationsTable.participant1, p1), eq(conversationsTable.participant2, p2), eq(conversationsTable.type, 'dm'))).limit(1);
    if (existing.length > 0) return res.json({ conversation: existing[0] });

    const [created] = await db.insert(conversationsTable)
      .values({ participant1: p1, participant2: p2, type: 'dm' }).returning();
    return res.json({ conversation: created });
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/conversations/:id/participants", requireSession, async (req, res) => {
  const me = (req as any).userHash as string;
  const convId = parseInt(req.params['id'] as string);
  const { addHash } = req.body;
  if (!addHash) return res.status(400).json({ error: "addHash required" });

  try {
    const conv = await db.select().from(conversationsTable).where(eq(conversationsTable.id, convId)).limit(1);
    if (!conv.length) return res.status(404).json({ error: "Conversation not found" });
    const c = conv[0];

    const hasAccess = await canAccess(convId, me);
    if (!hasAccess) return res.status(403).json({ error: "Access denied" });

    const alreadyIn = await canAccess(convId, addHash);
    if (alreadyIn) return res.json({ success: true, message: 'already_member' });

    if (c.type === 'dm') {
      const existingParticipants = [c.participant1, c.participant2];
      const autoName = await buildGroupName([...existingParticipants, addHash]);

      await db.update(conversationsTable)
        .set({ type: 'group', name: autoName })
        .where(eq(conversationsTable.id, convId));

      for (const h of existingParticipants) {
        await db.insert(conversationParticipantsTable)
          .values({ conversationId: convId, userHash: h })
          .onConflictDoNothing();
      }
    }

    await db.insert(conversationParticipantsTable)
      .values({ conversationId: convId, userHash: addHash })
      .onConflictDoNothing();

    const updatedConv = await db.select().from(conversationsTable).where(eq(conversationsTable.id, convId)).limit(1);
    const participantRows = await db.select().from(conversationParticipantsTable)
      .where(eq(conversationParticipantsTable.conversationId, convId));
    const participantInfos = await Promise.all(participantRows.map(p => getAuthorInfo(p.userHash)));

    const addedInfo = await getAuthorInfo(addHash);
    await db.insert(messagesTable).values({
      conversationId: convId,
      senderHash: '__system__',
      content: `${addedInfo.name} добавлен(а) в беседу`,
      messageType: 'system',
    });
    await db.update(conversationsTable).set({ lastMessageAt: new Date() }).where(eq(conversationsTable.id, convId));

    return res.json({
      success: true,
      conversation: {
        ...updatedConv[0],
        participants: participantRows.map((r, i) => ({ hash: r.userHash, info: participantInfos[i] })),
      },
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
});

async function buildGroupName(hashes: string[]): Promise<string> {
  const infos = await Promise.all(hashes.slice(0, 3).map(h => getAuthorInfo(h)));
  const names = infos.map(i => i.name.split(' ')[0]).join(', ');
  return `Беседа: ${names}${hashes.length > 3 ? ' и ещё...' : ''}`;
}

router.patch("/conversations/:id", requireSession, async (req, res) => {
  const me = (req as any).userHash as string;
  const convId = parseInt(req.params['id'] as string);
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Name required" });

  try {
    const hasAccess = await canAccess(convId, me);
    if (!hasAccess) return res.status(403).json({ error: "Access denied" });

    const [updated] = await db.update(conversationsTable)
      .set({ name: name.trim() })
      .where(eq(conversationsTable.id, convId))
      .returning();
    return res.json({ conversation: updated });
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/conversations/:id/participants", requireSession, async (req, res) => {
  const me = (req as any).userHash as string;
  const convId = parseInt(req.params['id'] as string);

  try {
    const hasAccess = await canAccess(convId, me);
    if (!hasAccess) return res.status(403).json({ error: "Access denied" });

    await db.delete(conversationParticipantsTable)
      .where(and(
        eq(conversationParticipantsTable.conversationId, convId),
        eq(conversationParticipantsTable.userHash, me)
      ));

    const info = await getAuthorInfo(me);
    await db.insert(messagesTable).values({
      conversationId: convId,
      senderHash: '__system__',
      content: `${info.name} покинул(а) беседу`,
      messageType: 'system',
    });
    await db.update(conversationsTable).set({ lastMessageAt: new Date() }).where(eq(conversationsTable.id, convId));

    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
});

/* ─────────────────────────── MESSAGES ─────────────────────────── */

router.get("/conversations/:id/messages", requireSession, async (req, res) => {
  const me = (req as any).userHash as string;
  const convId = parseInt(req.params['id'] as string);
  const limit = parseInt(req.query.limit as string) || 50;
  const before = req.query.before ? parseInt(req.query.before as string) : undefined;

  try {
    const hasAccess = await canAccess(convId, me);
    if (!hasAccess) return res.status(403).json({ error: "Access denied" });

    const msgs = await db.select().from(messagesTable)
      .where(and(
        eq(messagesTable.conversationId, convId),
        before ? sql`${messagesTable.id} < ${before}` : sql`1=1`
      ))
      .orderBy(desc(messagesTable.createdAt)).limit(limit);

    await db.update(messagesTable)
      .set({ isRead: true })
      .where(and(
        eq(messagesTable.conversationId, convId),
        eq(messagesTable.isRead, false),
        sql`${messagesTable.senderHash} != ${me}`
      ));

    const withInfo = await Promise.all(msgs.reverse().map(async m => {
      const info = m.senderHash === '__system__' ? { name: 'Система', avatar: '', handle: '' } : await getAuthorInfo(m.senderHash);
      const decrypted = m.messageType === 'system' ? m.content : decryptMessage(m.content, convId);
      return { ...m, content: decrypted, author: info };
    }));

    return res.json({ messages: withInfo });
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/conversations/:id/messages", requireSession, contentFilter("message", ["content"]), async (req, res) => {
  const me = (req as any).userHash as string;
  const convId = parseInt(req.params['id'] as string);
  const { content = '', messageType = 'text', mediaUrl, mediaName, duration } = req.body;

  if (!msgRateLimit(me)) return res.status(429).json({ error: "Слишком много сообщений. Подождите минуту." });
  if (typeof content === 'string' && content.length > MAX_MSG_LENGTH) return res.status(400).json({ error: "Сообщение слишком длинное" });

  try {
    const hasAccess = await canAccess(convId, me);
    if (!hasAccess) return res.status(403).json({ error: "Access denied" });

    const encryptedContent = messageType === 'system'
      ? content
      : encryptMessage(content, convId);

    const [msg] = await db.insert(messagesTable).values({
      conversationId: convId,
      senderHash: me,
      content: encryptedContent,
      messageType,
      mediaUrl: mediaUrl ?? null,
      mediaName: mediaName ?? null,
      duration: duration ?? null,
    }).returning();

    await db.update(conversationsTable)
      .set({ lastMessageAt: new Date() })
      .where(eq(conversationsTable.id, convId));

    const author = await getAuthorInfo(me);
    const decryptedContent = msg.messageType === 'system' ? msg.content : decryptMessage(msg.content, convId);
    return res.json({ ...msg, content: decryptedContent, author });
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/conversations/:convId/messages/:msgId", requireSession, async (req, res) => {
  const me = (req as any).userHash as string;
  const msgId = parseInt(req.params['msgId'] as string);
  try {
    const msg = await db.select().from(messagesTable).where(eq(messagesTable.id, msgId)).limit(1);
    if (!msg.length || msg[0].senderHash !== me) return res.status(403).json({ error: "Forbidden" });
    await db.delete(messagesTable).where(eq(messagesTable.id, msgId));
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/contacts", requireSession, async (req, res) => {
  const me = (req as any).userHash as string;
  try {
    const [following, followers] = await Promise.all([
      db.select({ hash: followsTable.followingHash }).from(followsTable).where(eq(followsTable.followerHash, me)),
      db.select({ hash: followsTable.followerHash }).from(followsTable).where(eq(followsTable.followingHash, me)),
    ]);
    const hashes = [...new Set([...following.map(f => f.hash), ...followers.map(f => f.hash)])];
    const infos = await Promise.all(hashes.map(h => getAuthorInfo(h)));
    return res.json({ contacts: hashes.map((h, i) => ({ hash: h, info: infos[i] })) });
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
});

/* ── Список связей Круга: friends / followers / following ── */
router.get("/circle-connections", requireSession, async (req, res) => {
  const me = (req as any).userHash as string;
  try {
    const [followingRows, followerRows] = await Promise.all([
      db.select({ hash: followsTable.followingHash }).from(followsTable).where(eq(followsTable.followerHash, me)),
      db.select({ hash: followsTable.followerHash }).from(followsTable).where(eq(followsTable.followingHash, me)),
    ]);
    const followingSet = new Set(followingRows.map(f => f.hash));
    const followerSet  = new Set(followerRows.map(f => f.hash));

    const friendHashes    = [...followingSet].filter(h => followerSet.has(h));
    const followingOnly   = [...followingSet].filter(h => !followerSet.has(h));
    const followersOnly   = [...followerSet].filter(h => !followingSet.has(h));

    const allHashes = [...friendHashes, ...followingOnly, ...followersOnly];
    const infos = await Promise.all(allHashes.map(h => getAuthorInfo(h)));
    const infoMap = Object.fromEntries(allHashes.map((h, i) => [h, infos[i]]));

    return res.json({
      friends:    friendHashes.map(h => ({ hash: h, info: infoMap[h] })),
      following:  followingOnly.map(h => ({ hash: h, info: infoMap[h] })),
      followers:  followersOnly.map(h => ({ hash: h, info: infoMap[h] })),
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
