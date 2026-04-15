import { Router } from "express";
import fs from "fs";
import path from "path";
import { logger } from "../lib/logger";
import { contentFilter } from "../middlewares/contentFilter.js";

const router = Router();
const DATA_FILE = path.join(process.cwd(), "interactions.json");

type Reply = {
  id: string;
  authorHash: string;
  authorName: string;
  authorAvatar?: string;
  authorMode?: string;
  text: string;
  audioUrl?: string;
  ts: string;
  likes: Record<string, boolean>;
};

type Comment = {
  id: string;
  authorHash: string;
  authorName: string;
  authorAvatar?: string;
  authorMode?: string;
  text: string;
  audioUrl?: string;
  ts: string;
  likes: Record<string, boolean>;
  reactions: Record<string, string>;
  replies: Reply[];
};

type PostInteractions = {
  likes: Record<string, boolean>;
  reactions: Record<string, string>;
  comments: Comment[];
};
type Store = Record<string, PostInteractions>;

function loadStore(): Store {
  try { if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { /* ignore */ }
  return {};
}
function saveStore(store: Store) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(store), "utf8"); } catch(e) { logger.error(e); }
}
function getPost(store: Store, postId: string): PostInteractions {
  if (!store[postId]) store[postId] = { likes: {}, reactions: {}, comments: [] };
  return store[postId];
}

/* Паттерн реального session token: 64hex.64hex
 * SceneScreen/KrugScreen передают user_${hash}_${mode} — НЕ совпадает с этим паттерном.
 * Если кто-то случайно передаёт реальный токен — отклоняем с ошибкой. */
const REAL_TOKEN_RE = /^[0-9a-f]{64}\.[0-9a-f]{64}$/;

function rejectRealToken(session: string | undefined, res: any): boolean {
  if (session && REAL_TOKEN_RE.test(session)) {
    res.status(400).json({ error: "Не передавайте session token — используйте userHash как идентификатор" });
    return true;
  }
  return false;
}

function migrateComment(c: Partial<Comment> & { id:string; authorHash:string; authorName:string; text:string; ts:string }): Comment {
  return {
    id: c.id,
    authorHash: c.authorHash,
    authorName: c.authorName,
    authorAvatar: c.authorAvatar || "",
    authorMode: c.authorMode || "pro",
    text: c.text,
    audioUrl: c.audioUrl,
    ts: c.ts,
    likes: c.likes ?? {},
    reactions: c.reactions ?? {},
    replies: (c.replies ?? []).map(r => ({
      id: r.id,
      authorHash: r.authorHash,
      authorName: r.authorName,
      authorAvatar: r.authorAvatar,
      authorMode: r.authorMode,
      text: r.text,
      audioUrl: r.audioUrl,
      ts: r.ts,
      likes: r.likes ?? {},
    })),
  };
}

function summaryComment(c: Comment, session: string) {
  return {
    id: c.id,
    authorHash: c.authorHash,
    authorName: c.authorName,
    authorAvatar: c.authorAvatar,
    authorMode: c.authorMode,
    text: c.text,
    audioUrl: c.audioUrl,
    ts: c.ts,
    likesCount: Object.values(c.likes).filter(Boolean).length,
    myLike: !!c.likes[session],
    reactions: Object.values(c.reactions).reduce<Record<string,number>>((acc, emoji) => {
      if (emoji) acc[emoji] = (acc[emoji] ?? 0) + 1; return acc;
    }, {}),
    myReaction: c.reactions[session] ?? null,
    replies: c.replies.map(r => ({
      id: r.id,
      authorHash: r.authorHash,
      authorName: r.authorName,
      authorAvatar: r.authorAvatar,
      authorMode: r.authorMode,
      text: r.text,
      audioUrl: r.audioUrl,
      ts: r.ts,
      likesCount: Object.values(r.likes).filter(Boolean).length,
      myLike: !!r.likes[session],
    })),
  };
}

function summary(p: PostInteractions, session: string) {
  return {
    likesCount: Object.values(p.likes).filter(Boolean).length,
    reactions: Object.values(p.reactions).reduce<Record<string,number>>((acc, emoji) => {
      if (emoji) acc[emoji] = (acc[emoji] ?? 0) + 1; return acc;
    }, {}),
    comments: p.comments.map(c => summaryComment(migrateComment(c), session)),
    myLike: !!p.likes[session],
    myReaction: p.reactions[session] ?? null,
  };
}

/* GET /interactions/:postId?session=xxx */
router.get("/interactions/:postId", (req, res): void => {
  const store = loadStore();
  const postId = String(req.params['postId']);
  const p = getPost(store, postId);
  const session = (req.query.session as string) || "";
  res.json(summary(p, session));
});

/* POST /interactions/:postId/like */
router.post("/interactions/:postId/like", (req, res): void => {
  const store = loadStore();
  const postId = String(req.params['postId']);
  const p = getPost(store, postId);
  const { session } = req.body as { session: string };
  if (!session) { res.status(400).json({ error: "session required" }); return; }
  if (rejectRealToken(session, res)) return;
  if (p.likes[session]) delete p.likes[session]; else p.likes[session] = true;
  saveStore(store);
  res.json(summary(p, session));
});

/* POST /interactions/:postId/reaction */
router.post("/interactions/:postId/reaction", (req, res): void => {
  const store = loadStore();
  const postId = String(req.params['postId']);
  const p = getPost(store, postId);
  const { session, emoji } = req.body as { session: string; emoji: string };
  if (!session) { res.status(400).json({ error: "session required" }); return; }
  if (rejectRealToken(session, res)) return;
  if (p.reactions[session] === emoji) delete p.reactions[session];
  else p.reactions[session] = emoji;
  saveStore(store);
  res.json(summary(p, session));
});

/* POST /interactions/:postId/comment */
router.post("/interactions/:postId/comment", contentFilter("comment", ["text"]), (req, res): void => {
  const store = loadStore();
  const postId = String(req.params['postId']);
  const p = getPost(store, postId);
  const { session, authorHash, authorName, authorAvatar, authorMode, text, audioUrl } =
    req.body as { session:string; authorHash:string; authorName:string; authorAvatar?:string; authorMode?:string; text:string; audioUrl?:string };
  if (!session || (!text?.trim() && !audioUrl)) { res.status(400).json({ error: "session and text or audio required" }); return; }
  if (rejectRealToken(session, res)) return;
  const comment: Comment = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    authorHash: authorHash || session,
    authorName: authorName || "Гость",
    authorAvatar: authorAvatar || "",
    authorMode: authorMode || "pro",
    text: text?.trim() || "",
    audioUrl: audioUrl || undefined,
    ts: new Date().toLocaleString("ru", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" }),
    likes: {},
    reactions: {},
    replies: [],
  };
  p.comments.push(comment);
  saveStore(store);
  res.json(summary(p, session));
});

/* POST /interactions/:postId/comment/:commentId/like */
router.post("/interactions/:postId/comment/:commentId/like", (req, res): void => {
  const store = loadStore();
  const { postId, commentId } = req.params as { postId:string; commentId:string };
  const p = getPost(store, postId);
  const { session } = req.body as { session: string };
  if (!session) { res.status(400).json({ error: "session required" }); return; }
  if (rejectRealToken(session, res)) return;
  const c = p.comments.find(c => c.id === commentId);
  if (!c) { res.status(404).json({ error: "comment not found" }); return; }
  const mc = migrateComment(c as Comment);
  if (mc.likes[session]) delete mc.likes[session]; else mc.likes[session] = true;
  Object.assign(c, mc);
  saveStore(store);
  res.json({ commentId, likesCount: Object.values(mc.likes).filter(Boolean).length, myLike: !!mc.likes[session] });
});

/* POST /interactions/:postId/comment/:commentId/reaction */
router.post("/interactions/:postId/comment/:commentId/reaction", (req, res): void => {
  const store = loadStore();
  const { postId, commentId } = req.params as { postId:string; commentId:string };
  const p = getPost(store, postId);
  const { session, emoji } = req.body as { session: string; emoji: string };
  if (!session) { res.status(400).json({ error: "session required" }); return; }
  if (rejectRealToken(session, res)) return;
  const c = p.comments.find(c => c.id === commentId);
  if (!c) { res.status(404).json({ error: "comment not found" }); return; }
  const mc = migrateComment(c as Comment);
  if (mc.reactions[session] === emoji) delete mc.reactions[session];
  else mc.reactions[session] = emoji;
  Object.assign(c, mc);
  saveStore(store);
  const reactSummary = Object.values(mc.reactions).reduce<Record<string,number>>((acc, e) => {
    if (e) acc[e] = (acc[e] ?? 0) + 1; return acc;
  }, {});
  res.json({ commentId, reactions: reactSummary, myReaction: mc.reactions[session] ?? null });
});

/* POST /interactions/:postId/comment/:commentId/reply */
router.post("/interactions/:postId/comment/:commentId/reply", contentFilter("reply", ["text"]), (req, res): void => {
  const store = loadStore();
  const { postId, commentId } = req.params as { postId:string; commentId:string };
  const p = getPost(store, postId);
  const { session, authorHash, authorName, authorAvatar, authorMode, text, audioUrl } =
    req.body as { session:string; authorHash:string; authorName:string; authorAvatar?:string; authorMode?:string; text:string; audioUrl?:string };
  if (!session || (!text?.trim() && !audioUrl)) { res.status(400).json({ error: "session and text or audio required" }); return; }
  if (rejectRealToken(session, res)) return;
  const c = p.comments.find(c => c.id === commentId);
  if (!c) { res.status(404).json({ error: "comment not found" }); return; }
  const mc = migrateComment(c as Comment);
  const reply: Reply = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    authorHash: authorHash || session,
    authorName: authorName || "Гость",
    authorAvatar: authorAvatar || "",
    authorMode: authorMode || "pro",
    text: text?.trim() || "",
    audioUrl: audioUrl || undefined,
    ts: new Date().toLocaleString("ru", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" }),
    likes: {},
  };
  mc.replies.push(reply);
  Object.assign(c, mc);
  saveStore(store);
  res.json(summary(p, session));
});

/* POST /interactions/:postId/comment/:commentId/reply/:replyId/like */
router.post("/interactions/:postId/comment/:commentId/reply/:replyId/like", (req, res): void => {
  const store = loadStore();
  const { postId, commentId, replyId } = req.params as { postId:string; commentId:string; replyId:string };
  const p = getPost(store, postId);
  const { session } = req.body as { session: string };
  if (!session) { res.status(400).json({ error: "session required" }); return; }
  if (rejectRealToken(session, res)) return;
  const c = p.comments.find(c => c.id === commentId);
  if (!c) { res.status(404).json({ error: "comment not found" }); return; }
  const mc = migrateComment(c as Comment);
  const r = mc.replies.find(r => r.id === replyId);
  if (!r) { res.status(404).json({ error: "reply not found" }); return; }
  if (r.likes[session]) delete r.likes[session]; else r.likes[session] = true;
  Object.assign(c, mc);
  saveStore(store);
  res.json({ replyId, likesCount: Object.values(r.likes).filter(Boolean).length, myLike: !!r.likes[session] });
});

export default router;
