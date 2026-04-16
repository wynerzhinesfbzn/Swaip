import { Router, type IRouter } from "express";
import { db, accountsTable, storiesTable } from "@workspace/db";
import { eq, gt, desc, inArray } from "drizzle-orm";
import { requireSession } from "../lib/sessionAuth.js";

const router: IRouter = Router();

function getField(data: Record<string, unknown>, key: string): string {
  const raw = data[key];
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") {
    try { const p = JSON.parse(raw); return typeof p === "string" ? p : ""; } catch { return raw; }
  }
  return "";
}

async function getAuthorInfo(hash: string, mode: string) {
  const rows = await db.select().from(accountsTable).where(eq(accountsTable.hash, hash)).limit(1);
  if (!rows.length) return { name: "Пользователь", avatar: "", handle: "" };
  const data = (rows[0].data as Record<string, unknown>) || {};
  if (mode === "scene") {
    return {
      name:   getField(data, "scene_artistName") || "Артист",
      avatar: getField(data, "scene_avatarUrl"),
      handle: getField(data, "scene_handle"),
    };
  }
  if (mode === "krug") {
    return {
      name:   getField(data, "krug_name") || "Участник",
      avatar: getField(data, "krug_avatarUrl"),
      handle: getField(data, "krug_handle"),
    };
  }
  return {
    name:   getField(data, "pro_name") || "Пользователь",
    avatar: getField(data, "pro_avatarUrl"),
    handle: getField(data, "pro_handle"),
  };
}

/* ── GET /api/stories — все активные истории, сгруппированные по автору ── */
router.get("/api/stories", async (_req, res) => {
  try {
    const now = new Date();
    const rows = await db
      .select()
      .from(storiesTable)
      .where(gt(storiesTable.expiresAt, now))
      .orderBy(desc(storiesTable.createdAt));

    if (!rows.length) return res.json({ groups: [] });

    const hashSet = [...new Set(rows.map(r => r.authorHash))];
    const authorInfoMap: Record<string, { name: string; avatar: string; handle: string }> = {};
    await Promise.all(hashSet.map(async h => {
      const mode = rows.find(r => r.authorHash === h)?.authorMode ?? "pro";
      authorInfoMap[h] = await getAuthorInfo(h, mode);
    }));

    const grouped: Record<string, {
      authorHash: string;
      authorMode: string;
      authorName: string;
      authorAvatar: string;
      authorHandle: string;
      stories: typeof rows;
    }> = {};

    for (const row of rows) {
      if (!grouped[row.authorHash]) {
        grouped[row.authorHash] = {
          authorHash:   row.authorHash,
          authorMode:   row.authorMode,
          authorName:   authorInfoMap[row.authorHash]?.name ?? "Пользователь",
          authorAvatar: authorInfoMap[row.authorHash]?.avatar ?? "",
          authorHandle: authorInfoMap[row.authorHash]?.handle ?? "",
          stories:      [],
        };
      }
      grouped[row.authorHash].stories.push(row);
    }

    res.json({ groups: Object.values(grouped) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "internal" });
  }
});

/* ── POST /api/stories — создать историю ── */
router.post("/api/stories", requireSession, async (req, res) => {
  try {
    const userHash: string = (req as any).userHash;
    const { authorMode = "pro", mediaType, mediaUrl, textContent, bgGradient } = req.body as {
      authorMode?: string;
      mediaType: string;
      mediaUrl?: string;
      textContent?: string;
      bgGradient?: string;
    };

    if (!["video", "image", "text"].includes(mediaType)) {
      return res.status(400).json({ error: "invalid mediaType" });
    }
    if (mediaType !== "text" && !mediaUrl) {
      return res.status(400).json({ error: "mediaUrl required for video/image" });
    }
    if (mediaType === "text" && !textContent) {
      return res.status(400).json({ error: "textContent required for text story" });
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const [inserted] = await db.insert(storiesTable).values({
      authorHash:  userHash,
      authorMode,
      mediaType,
      mediaUrl:    mediaUrl ?? null,
      textContent: textContent ?? null,
      bgGradient:  bgGradient ?? null,
      expiresAt,
    }).returning();

    res.json({ story: inserted });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "internal" });
  }
});

/* ── DELETE /api/stories/:id — удалить свою историю ── */
router.delete("/api/stories/:id", requireSession, async (req, res) => {
  try {
    const userHash: string = (req as any).userHash;
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "invalid id" });

    const [row] = await db.select().from(storiesTable).where(eq(storiesTable.id, id)).limit(1);
    if (!row) return res.status(404).json({ error: "not found" });
    if (row.authorHash !== userHash) return res.status(403).json({ error: "forbidden" });

    await db.delete(storiesTable).where(eq(storiesTable.id, id));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "internal" });
  }
});

export default router;
