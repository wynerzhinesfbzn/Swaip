import { Router, type IRouter } from "express";
import { db, meetingsTable, meetingParticipantsTable, meetingMessagesTable, meetingLogsTable, accountsTable } from "@workspace/db";
import { eq, desc, asc, sql } from "drizzle-orm";
import { createHmac, randomBytes } from "node:crypto";
import { requireSession, resolveSession, getSessionToken } from "../lib/sessionAuth.js";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import multer from "multer";
import crypto from "node:crypto";
import { objectStorageClient } from "../lib/objectStorage.js";
import { broadcastToMeeting, kickParticipantWs } from "../lib/meetingChatWs.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function getBucket() {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
  return objectStorageClient.bucket(bucketId);
}

async function uploadMeetingFile(buf: Buffer, filename: string, mimeType: string): Promise<string> {
  const objectName = `meeting_files/${filename}`;
  const bucket = getBucket();
  const file = bucket.file(objectName);
  await file.save(buf, { contentType: mimeType, resumable: false });
  return `/api/meeting-file/${filename}`;
}

const router: IRouter = Router();

/* ──────────────────────────────────────────────────
 * GET /api/meeting-file/:filename — отдать загруженный файл из хранилища
 * ────────────────────────────────────────────────── */
router.get("/meeting-file/:filename", async (req, res) => {
  const { filename } = req.params;
  if (!/^[\w\-.]+$/.test(filename)) { res.status(400).json({ error: "Неверное имя файла" }); return; }
  try {
    const bucket = getBucket();
    const file = bucket.file(`meeting_files/${filename}`);
    const [exists] = await file.exists();
    if (!exists) { res.status(404).json({ error: "Файл не найден" }); return; }
    const [metadata] = await file.getMetadata();
    const contentType = (metadata.contentType as string) || "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Accept-Ranges", "bytes");
    file.createReadStream().pipe(res);
  } catch {
    res.status(404).json({ error: "Файл не найден" });
  }
});

async function logAction(meetingId: string, action: string, actorId: string, targetId?: string, details?: object) {
  try {
    await db.insert(meetingLogsTable).values({
      meetingId, action, actorParticipantId: actorId,
      targetParticipantId: targetId || null,
      details: details ? JSON.stringify(details) : null,
    });
  } catch {}
}

const SECRET = process.env.SESSION_SECRET || "fallback-dev-secret-change-in-prod";

function genMeetingId(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
function genToken(len = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let t = "";
  for (let i = 0; i < len; i++) t += chars[Math.floor(Math.random() * chars.length)];
  return t;
}
function genParticipantId(): string {
  return randomBytes(20).toString("hex");
}
function signParticipantToken(participantId: string, meetingId: string): string {
  const mac = createHmac("sha256", SECRET).update(`${participantId}:${meetingId}`).digest("hex");
  return `${participantId}.${meetingId}.${mac}`;
}
function verifyParticipantToken(token: string): { participantId: string; meetingId: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [participantId, meetingId, mac] = parts;
    const expected = createHmac("sha256", SECRET).update(`${participantId}:${meetingId}`).digest("hex");
    if (mac !== expected) return null;
    return { participantId, meetingId };
  } catch { return null; }
}

/* ──────────────────────────────────────────────────
 * POST /api/meetings/create
 * ────────────────────────────────────────────────── */
router.post("/meetings/create", requireSession, async (req, res) => {
  const creatorHash: string = (req as any).userHash;
  const { name, startTime, tokenType = "common", codeWord, tokenExpiry, allowAnonymous, anonymousGuest } = req.body;
  if (!name || typeof name !== "string" || !name.trim())
    return res.status(400).json({ error: "Название совещания обязательно" });

  const meetingId = genMeetingId();
  const commonToken = tokenType === "common" ? genToken() : null;
  let tokenExpiryTs: number | null = null;
  if (tokenExpiry === "1h") tokenExpiryTs = Math.floor(Date.now() / 1000) + 3600;
  else if (tokenExpiry === "1d") tokenExpiryTs = Math.floor(Date.now() / 1000) + 86400;
  let startTimeTs: number | null = null;
  if (startTime) startTimeTs = Math.floor(new Date(startTime).getTime() / 1000);

  /* Генерируем отдельный анонимный токен, если запрошен */
  let anonymousToken: string | null = null;
  if (anonymousGuest) {
    do { anonymousToken = genToken().slice(0, 7); }
    while (anonymousToken === commonToken);
  }

  await db.insert(meetingsTable).values({
    meetingId, creatorHash, name: name.trim(), startTime: startTimeTs,
    tokenType, commonToken, codeWord: codeWord?.trim() || null,
    tokenExpiry: tokenExpiryTs, allowAnonymous: !!allowAnonymous,
    anonymousToken,
  });

  const origin = `${req.protocol}://${req.get("host")}`;
  const inviteLink = commonToken
    ? `${origin}/meet/${meetingId}?token=${commonToken}`
    : `${origin}/meet/${meetingId}`;
  const anonLink = anonymousToken
    ? `${origin}/meet/${meetingId}?token=${anonymousToken}`
    : null;

  return res.json({ meetingId, commonToken, inviteLink, anonymousToken, anonLink });
});

/* ──────────────────────────────────────────────────
 * GET /api/meetings/my
 * ────────────────────────────────────────────────── */
router.get("/meetings/my", requireSession, async (req, res) => {
  const creatorHash: string = (req as any).userHash;
  const rows = await db.select().from(meetingsTable)
    .where(eq(meetingsTable.creatorHash, creatorHash))
    .orderBy(desc(meetingsTable.createdAt));

  // Resolve creator display name from account data
  let creatorName = "";
  try {
    const accRows = await db.select({ data: accountsTable.data }).from(accountsTable)
      .where(eq(accountsTable.hash, creatorHash)).limit(1);
    if (accRows.length) {
      const d = accRows[0].data as Record<string, unknown>;
      creatorName = (
        d.pro_fullName || d.pro_displayName ||
        d.scene_artistName || d.krug_displayName || ""
      ) as string;
    }
  } catch {}

  return res.json({ meetings: rows, creatorName });
});

/* ──────────────────────────────────────────────────
 * DELETE /api/meetings/:meetingId
 * ────────────────────────────────────────────────── */
router.delete("/meetings/:meetingId", requireSession, async (req, res) => {
  const creatorHash: string = (req as any).userHash;
  const { meetingId } = req.params;
  const rows = await db.select().from(meetingsTable).where(eq(meetingsTable.meetingId, meetingId)).limit(1);
  if (!rows.length) return res.status(404).json({ error: "Не найдено" });
  if (rows[0].creatorHash !== creatorHash) return res.status(403).json({ error: "Нет доступа" });
  await db.delete(meetingsTable).where(eq(meetingsTable.meetingId, meetingId));
  return res.json({ ok: true });
});

/* ──────────────────────────────────────────────────
 * GET /api/meetings/info/:meetingId
 * Публичный — только базовая информация о комнате
 * ────────────────────────────────────────────────── */
router.get("/meetings/info/:meetingId", async (req, res) => {
  const { meetingId } = req.params;
  const rows = await db.select().from(meetingsTable).where(eq(meetingsTable.meetingId, meetingId)).limit(1);
  if (!rows.length) return res.status(404).json({ error: "Комната не найдена" });
  const m = rows[0];
  return res.json({
    name: m.name,
    startTime: m.startTime,
    tokenType: m.tokenType,
    hasCodeWord: !!m.codeWord,
    allowAnonymous: m.allowAnonymous,
    tokenExpiry: m.tokenExpiry,
    anonymousToken: m.anonymousToken ?? null,
  });
});

/* ──────────────────────────────────────────────────
 * POST /api/meetings/validate
 * Вход в комнату: проверка токена, кодового слова, времени
 * ────────────────────────────────────────────────── */
router.post("/meetings/validate", async (req, res) => {
  const { meetingId, name, lastName, position, token, codeWord, isAnonymous: wantsAnon } = req.body;

  if (!meetingId) return res.status(400).json({ error: "meetingId обязателен" });

  const rows = await db.select().from(meetingsTable).where(eq(meetingsTable.meetingId, meetingId)).limit(1);
  if (!rows.length) return res.status(404).json({ error: "Комната не найдена" });
  const m = rows[0];

  /* Проверяем, является ли переданный токен анонимным */
  const isAnonByToken = !!(token?.trim() && m.anonymousToken &&
    token.trim().toUpperCase() === m.anonymousToken.toUpperCase());

  /* isAnon = либо токен совпал с anonymousToken, либо флаг isAnonymous + allowAnonymous */
  const isAnon = isAnonByToken || !!(wantsAnon && m.allowAnonymous);

  if (!isAnon && !name?.trim())
    return res.status(400).json({ error: "Введите ваше имя" });

  const nowSec = Math.floor(Date.now() / 1000);

  if (m.startTime && nowSec < m.startTime)
    return res.status(403).json({ error: "Совещание ещё не началось", startTime: m.startTime });

  if (m.tokenExpiry && nowSec > m.tokenExpiry)
    return res.status(403).json({ error: "Срок действия ссылки истёк" });

  /* Проверка токена (пропускаем если это anonymousToken — уже проверен выше) */
  if (!isAnonByToken) {
    if (m.tokenType === "common") {
      if (!token?.trim() || token.trim().toUpperCase() !== (m.commonToken || "").toUpperCase())
        return res.status(403).json({ error: "Неверный токен доступа" });
    } else if (m.tokenType === "individual") {
      if (!token?.trim())
        return res.status(403).json({ error: "Введите индивидуальный токен" });
    }

    if (m.codeWord) {
      if (!codeWord?.trim() || codeWord.trim().toLowerCase() !== m.codeWord.toLowerCase())
        return res.status(403).json({ error: "Неверное кодовое слово" });
    }
  }

  const sessionToken = getSessionToken(req);
  const currentUserHash = sessionToken ? await resolveSession(sessionToken) : null;
  const participantRole = (currentUserHash && currentUserHash === m.creatorHash) ? "host" : "participant";

  const participantId = genParticipantId();
  const finalName     = isAnon ? "Гость" : name.trim();
  const finalLastName = isAnon ? `#${participantId.slice(0, 4).toUpperCase()}` : (lastName?.trim() || '');

  const finalRole = isAnon ? "participant" : participantRole;

  /* Назначаем порядковый номер участника */
  const maxNumRes = await db
    .select({ maxNum: sql<number>`MAX(${meetingParticipantsTable.number})` })
    .from(meetingParticipantsTable)
    .where(eq(meetingParticipantsTable.meetingId, meetingId));
  const nextNum = (maxNumRes[0]?.maxNum ?? 0) + 1;

  await db.insert(meetingParticipantsTable).values({
    meetingId,
    participantId,
    name: finalName,
    lastName: finalLastName,
    position: isAnon ? null : (position?.trim() || null),
    isAnonymous: isAnon,
    role: finalRole,
    number: nextNum,
  });

  /* Немедленно оповещаем уже подключённых участников */
  broadcastToMeeting(meetingId, {
    type: "participant_joined",
    participantId,
    name: finalName,
    lastName: finalLastName,
    position: isAnon ? null : (position?.trim() || null),
    isAnonymous: isAnon,
    role: finalRole,
    number: nextNum,
  });

  const participantToken = signParticipantToken(participantId, meetingId);

  return res.json({
    success: true,
    participantToken,
    meetingData: {
      name: m.name,
      startTime: m.startTime,
      allowAnonymous: m.allowAnonymous,
      creatorHash: m.creatorHash,
    },
  });
});

/* ──────────────────────────────────────────────────
 * GET /api/meetings/check-participant
 * Проверить participantToken (для защиты комнаты)
 * ────────────────────────────────────────────────── */
router.get("/meetings/check-participant", async (req, res) => {
  const token = req.headers["x-participant-token"] as string || req.query.token as string;
  if (!token) return res.status(401).json({ valid: false });

  const parsed = verifyParticipantToken(token);
  if (!parsed) return res.status(401).json({ valid: false });

  const { participantId, meetingId } = parsed;

  const pRows = await db.select().from(meetingParticipantsTable)
    .where(eq(meetingParticipantsTable.participantId, participantId)).limit(1);
  if (!pRows.length || pRows[0].meetingId !== meetingId)
    return res.status(401).json({ valid: false });

  const mRows = await db.select().from(meetingsTable).where(eq(meetingsTable.meetingId, meetingId)).limit(1);
  if (!mRows.length) return res.status(401).json({ valid: false });

  const sessionToken = getSessionToken(req);
  const currentUserHash = sessionToken ? await resolveSession(sessionToken) : null;

  return res.json({
    valid: true,
    participantId,
    meetingId,
    meetingName: mRows[0].name,
    name: pRows[0].name,
    lastName: pRows[0].lastName,
    position: pRows[0].position,
    role: pRows[0].role,
    creatorHash: mRows[0].creatorHash,
    isHost: !!currentUserHash && currentUserHash === mRows[0].creatorHash,
  });
});

/* ──────────────────────────────────────────────────
 * POST /api/meetings/:meetingId/leave
 * Участник покидает комнату — удаляем запись из БД
 * и оповещаем остальных через WS
 * ────────────────────────────────────────────────── */
router.post("/meetings/:meetingId/leave", async (req, res) => {
  const token = req.headers["x-participant-token"] as string;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const parsed = verifyParticipantToken(token);
  if (!parsed) return res.status(401).json({ error: "Недействительный токен" });

  const { participantId, meetingId } = parsed;
  if (meetingId !== req.params.meetingId)
    return res.status(403).json({ error: "Нет доступа" });

  await db.delete(meetingParticipantsTable)
    .where(eq(meetingParticipantsTable.participantId, participantId));

  broadcastToMeeting(meetingId, { type: "participant_left", participantId });

  return res.json({ ok: true });
});

/* ──────────────────────────────────────────────────
 * POST /api/meetings/token
 * Выдаёт LiveKit-токен для подключения к комнате
 * ────────────────────────────────────────────────── */
router.post("/meetings/token", async (req, res) => {
  const participantToken = req.headers["x-participant-token"] as string;
  if (!participantToken) return res.status(401).json({ error: "Нет токена участника" });

  const parsed = verifyParticipantToken(participantToken);
  if (!parsed) return res.status(401).json({ error: "Токен участника недействителен" });

  const { participantId, meetingId } = parsed;

  const pRows = await db.select().from(meetingParticipantsTable)
    .where(eq(meetingParticipantsTable.participantId, participantId)).limit(1);
  if (!pRows.length || pRows[0].meetingId !== meetingId)
    return res.status(401).json({ error: "Участник не найден" });

  const mRows = await db.select().from(meetingsTable).where(eq(meetingsTable.meetingId, meetingId)).limit(1);
  if (!mRows.length) return res.status(404).json({ error: "Совещание не найдено" });

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const serverUrl = process.env.LIVEKIT_URL;

  if (!apiKey || !apiSecret || !serverUrl)
    return res.status(500).json({ error: "LiveKit не настроен на сервере" });

  const { name, lastName, position } = pRows[0];
  const nameParts = [name, lastName].filter(Boolean).join(' ');
  const displayName = `${nameParts}${position ? ` · ${position}` : ""}`;

  const sessionToken = getSessionToken(req);
  const currentUserHash = sessionToken ? await resolveSession(sessionToken) : null;
  const isHost = !!currentUserHash && currentUserHash === mRows[0].creatorHash;

  const at = new AccessToken(apiKey, apiSecret, {
    identity: participantId,
    name: displayName,
    ttl: 12 * 60 * 60,
  });
  at.addGrant({
    roomJoin: true,
    room: meetingId,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: isHost,
  });

  const livekitToken = await at.toJwt();
  const normalizedServerUrl = (() => {
    let u = serverUrl.trim();
    if (/^wss?:\/\//i.test(u)) return u;
    if (/^https?:\/\//i.test(u)) return u.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
    const stripped = u.replace(/^[a-z][a-z0-9+\-.]*:\/\//i, '').replace(/^[a-z][a-z0-9+\-.]*:/i, '');
    return `wss://${stripped}`;
  })();
  return res.json({ token: livekitToken, serverUrl: normalizedServerUrl, isHost, meetingName: mRows[0].name });
});

/* ──────────────────────────────────────────────────
 * POST /api/meetings/:meetingId/end
 * Завершить совещание (только создатель)
 * ────────────────────────────────────────────────── */
router.post("/meetings/:meetingId/end", requireSession, async (req, res) => {
  const creatorHash: string = (req as any).userHash;
  const { meetingId } = req.params;

  const rows = await db.select().from(meetingsTable).where(eq(meetingsTable.meetingId, meetingId)).limit(1);
  if (!rows.length) return res.status(404).json({ error: "Не найдено" });
  if (rows[0].creatorHash !== creatorHash) return res.status(403).json({ error: "Нет доступа" });

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const serverUrl = process.env.LIVEKIT_URL;

  if (apiKey && apiSecret && serverUrl) {
    try {
      const httpUrl = serverUrl.replace("wss://", "https://").replace("ws://", "http://");
      const svc = new RoomServiceClient(httpUrl, apiKey, apiSecret);
      await svc.deleteRoom(meetingId);
    } catch (_) {}
  }

  broadcastToMeeting(meetingId, { type: "meeting_ended" });

  await db.delete(meetingParticipantsTable).where(eq(meetingParticipantsTable.meetingId, meetingId));
  await db.delete(meetingsTable).where(eq(meetingsTable.meetingId, meetingId));
  return res.json({ ok: true });
});

/* ──────────────────────────────────────────────────
 * POST /api/meetings/:meetingId/kick
 * Удалить участника (host, co-host, moderator)
 * ────────────────────────────────────────────────── */
router.post("/meetings/:meetingId/kick", async (req, res) => {
  const token = req.headers["x-participant-token"] as string;
  if (!token) return res.status(401).json({ error: "Нет токена" });
  const parsed = verifyParticipantToken(token);
  if (!parsed || parsed.meetingId !== req.params.meetingId) return res.status(401).json({ error: "Недействителен" });

  const actorRows = await db.select().from(meetingParticipantsTable)
    .where(eq(meetingParticipantsTable.participantId, parsed.participantId)).limit(1);
  if (!actorRows.length) return res.status(401).json({ error: "Нет данных" });

  const actorRole = actorRows[0].role;
  if (!["host", "co-host", "moderator"].includes(actorRole))
    return res.status(403).json({ error: "Нет прав удалять участников" });

  const { targetId } = req.body;
  if (!targetId) return res.status(400).json({ error: "targetId обязателен" });

  const targetRows = await db.select().from(meetingParticipantsTable)
    .where(eq(meetingParticipantsTable.participantId, targetId)).limit(1);
  if (!targetRows.length || targetRows[0].meetingId !== req.params.meetingId)
    return res.status(404).json({ error: "Участник не найден" });

  if (targetRows[0].role === "host")
    return res.status(403).json({ error: "Нельзя удалить ведущего" });

  kickParticipantWs(req.params.meetingId, targetId);

  await db.delete(meetingParticipantsTable)
    .where(eq(meetingParticipantsTable.participantId, targetId));

  await logAction(req.params.meetingId, "kick", parsed.participantId, targetId);
  return res.json({ ok: true });
});

/* ──────────────────────────────────────────────────
 * POST /api/meetings/:meetingId/mute-all
 * Заглушить всех (host / co-host)
 * ────────────────────────────────────────────────── */
router.post("/meetings/:meetingId/mute-all", async (req, res) => {
  const token = req.headers["x-participant-token"] as string;
  if (!token) return res.status(401).json({ error: "Нет токена" });
  const parsed = verifyParticipantToken(token);
  if (!parsed || parsed.meetingId !== req.params.meetingId) return res.status(401).json({ error: "Недействителен" });

  const actorRows = await db.select().from(meetingParticipantsTable)
    .where(eq(meetingParticipantsTable.participantId, parsed.participantId)).limit(1);
  if (!actorRows.length) return res.status(401).json({ error: "Нет данных" });

  if (!["host", "co-host"].includes(actorRows[0].role))
    return res.status(403).json({ error: "Только ведущий может отключать микрофоны" });

  broadcastToMeeting(req.params.meetingId, { type: "mute_all", actorId: parsed.participantId });
  await logAction(req.params.meetingId, "mute_all", parsed.participantId);
  return res.json({ ok: true });
});

/* ──────────────────────────────────────────────────
 * GET /api/meetings/:meetingId/messages
 * ────────────────────────────────────────────────── */
router.get("/meetings/:meetingId/messages", async (req, res) => {
  const token = req.headers["x-participant-token"] as string;
  if (!token) return res.status(401).json({ error: "Нет токена" });
  const parsed = verifyParticipantToken(token);
  if (!parsed || parsed.meetingId !== req.params.meetingId) return res.status(401).json({ error: "Недействителен" });

  const rows = await db.select().from(meetingMessagesTable)
    .where(eq(meetingMessagesTable.meetingId, req.params.meetingId))
    .orderBy(asc(meetingMessagesTable.createdAt))
    .limit(100);
  return res.json({ messages: rows });
});

/* ──────────────────────────────────────────────────
 * POST /api/meetings/:meetingId/messages — текст
 * ────────────────────────────────────────────────── */
router.post("/meetings/:meetingId/messages", async (req, res) => {
  const token = req.headers["x-participant-token"] as string;
  if (!token) return res.status(401).json({ error: "Нет токена" });
  const parsed = verifyParticipantToken(token);
  if (!parsed || parsed.meetingId !== req.params.meetingId) return res.status(401).json({ error: "Недействителен" });

  const { participantId, meetingId } = parsed;
  const pRows = await db.select().from(meetingParticipantsTable)
    .where(eq(meetingParticipantsTable.participantId, participantId)).limit(1);
  if (!pRows.length) return res.status(401).json({ error: "Участник не найден" });
  const p = pRows[0];

  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: "Пустое сообщение" });

  const senderName = [p.name, p.lastName].filter(Boolean).join(` `) + (p.position ? ` · ${p.position}` : "");
  const [msg] = await db.insert(meetingMessagesTable).values({
    meetingId, participantId, senderName, type: "text", content: content.trim(),
  }).returning();

  broadcastToMeeting(meetingId, { type: "new_message", message: msg });
  return res.json({ message: msg });
});

/* ──────────────────────────────────────────────────
 * POST /api/meetings/:meetingId/messages/upload — аудио / файл
 * ────────────────────────────────────────────────── */
router.post("/meetings/:meetingId/messages/upload", upload.single("file"), async (req, res) => {
  const token = req.headers["x-participant-token"] as string;
  if (!token) return res.status(401).json({ error: "Нет токена" });
  const parsed = verifyParticipantToken(token);
  if (!parsed || parsed.meetingId !== req.params.meetingId) return res.status(401).json({ error: "Недействителен" });

  const { participantId, meetingId } = parsed;
  const pRows = await db.select().from(meetingParticipantsTable)
    .where(eq(meetingParticipantsTable.participantId, participantId)).limit(1);
  if (!pRows.length) return res.status(401).json({ error: "Участник не найден" });
  const p = pRows[0];

  if (!req.file) return res.status(400).json({ error: "Файл не передан" });

  const isAnon = p.isAnonymous;
  if (isAnon) return res.status(403).json({ error: "Гости не могут прикреплять файлы" });

  const ext = req.file.originalname.split(".").pop() || "bin";
  const filename = `${crypto.randomUUID()}.${ext}`;
  const mimeType = req.file.mimetype || "application/octet-stream";
  const msgType = mimeType.startsWith("audio/") ? "audio" : "file";

  const fileUrl = await uploadMeetingFile(req.file.buffer, filename, mimeType);
  const senderName = [p.name, p.lastName].filter(Boolean).join(` `) + (p.position ? ` · ${p.position}` : "");

  const [msg] = await db.insert(meetingMessagesTable).values({
    meetingId, participantId, senderName, type: msgType,
    fileUrl, fileName: req.file.originalname, fileSize: req.file.size,
  }).returning();

  broadcastToMeeting(meetingId, { type: "new_message", message: msg });
  return res.json({ message: msg });
});

/* ──────────────────────────────────────────────────
 * DELETE /api/meetings/messages/:messageId — удалить (ведущий/модератор)
 * ────────────────────────────────────────────────── */
router.delete("/meetings/messages/:messageId", async (req, res) => {
  const token = req.headers["x-participant-token"] as string;
  if (!token) return res.status(401).json({ error: "Нет токена" });
  const parsed = verifyParticipantToken(token);
  if (!parsed) return res.status(401).json({ error: "Недействителен" });

  const msgId = parseInt(req.params.messageId, 10);
  if (isNaN(msgId)) return res.status(400).json({ error: "Неверный ID" });

  const [msgRow] = await db.select().from(meetingMessagesTable)
    .where(eq(meetingMessagesTable.id, msgId)).limit(1);
  if (!msgRow) return res.status(404).json({ error: "Сообщение не найдено" });
  if (msgRow.meetingId !== parsed.meetingId) return res.status(403).json({ error: "Нет доступа" });

  const pRows = await db.select().from(meetingParticipantsTable)
    .where(eq(meetingParticipantsTable.participantId, parsed.participantId)).limit(1);
  if (!pRows.length) return res.status(401).json({ error: "Участник не найден" });

  const canDelete = ["host", "co-host", "moderator"].includes(pRows[0].role)
    || pRows[0].participantId === msgRow.participantId;
  if (!canDelete) return res.status(403).json({ error: "Нет права удалять сообщения" });

  await db.delete(meetingMessagesTable).where(eq(meetingMessagesTable.id, msgId));
  broadcastToMeeting(parsed.meetingId, { type: "message_deleted", messageId: msgId });
  return res.json({ ok: true });
});

/* ──────────────────────────────────────────────────
 * PATCH /api/meetings/:meetingId/participants/:participantId/role
 * Сменить роль участника (только ведущий / со-ведущий)
 * ────────────────────────────────────────────────── */
router.patch("/meetings/:meetingId/participants/:targetId/role", async (req, res) => {
  const token = req.headers["x-participant-token"] as string;
  if (!token) return res.status(401).json({ error: "Нет токена" });
  const parsed = verifyParticipantToken(token);
  if (!parsed || parsed.meetingId !== req.params.meetingId) return res.status(401).json({ error: "Недействителен" });

  const actorRows = await db.select().from(meetingParticipantsTable)
    .where(eq(meetingParticipantsTable.participantId, parsed.participantId)).limit(1);
  if (!actorRows.length) return res.status(401).json({ error: "Нет данных" });

  const actorRole = actorRows[0].role;
  const { role } = req.body;
  const allowed = ["host", "co-host"].includes(actorRole);
  if (!allowed) return res.status(403).json({ error: "Только ведущий может менять роли" });
  if (!["co-host", "moderator", "participant"].includes(role))
    return res.status(400).json({ error: "Недопустимая роль" });

  await db.update(meetingParticipantsTable)
    .set({ role })
    .where(eq(meetingParticipantsTable.participantId, req.params.targetId));

  broadcastToMeeting(parsed.meetingId, {
    type: "role_change", targetId: req.params.targetId, role,
  });
  await logAction(parsed.meetingId, "role_change", parsed.participantId, req.params.targetId, { role });
  return res.json({ ok: true });
});

/* ──────────────────────────────────────────────────
 * GET /api/meetings/:meetingId/whiteboard — получить снапшот доски
 * ────────────────────────────────────────────────── */
router.get("/meetings/:meetingId/whiteboard", async (req, res) => {
  const token = req.headers["x-participant-token"] as string;
  if (!token) return res.status(401).json({ error: "Нет токена" });
  const parsed = verifyParticipantToken(token);
  if (!parsed || parsed.meetingId !== req.params.meetingId) return res.status(401).json({ error: "Недействителен" });

  const rows = await db.select({ whiteboardSnapshot: meetingsTable.whiteboardSnapshot })
    .from(meetingsTable).where(eq(meetingsTable.meetingId, req.params.meetingId)).limit(1);
  if (!rows.length) return res.status(404).json({ error: "Не найдено" });
  return res.json({ snapshot: rows[0].whiteboardSnapshot || null });
});

/* ──────────────────────────────────────────────────
 * POST /api/meetings/:meetingId/whiteboard — сохранить снапшот доски
 * ────────────────────────────────────────────────── */
router.post("/meetings/:meetingId/whiteboard", async (req, res) => {
  const token = req.headers["x-participant-token"] as string;
  if (!token) return res.status(401).json({ error: "Нет токена" });
  const parsed = verifyParticipantToken(token);
  if (!parsed || parsed.meetingId !== req.params.meetingId) return res.status(401).json({ error: "Недействителен" });

  const pRows = await db.select().from(meetingParticipantsTable)
    .where(eq(meetingParticipantsTable.participantId, parsed.participantId)).limit(1);
  if (!pRows.length) return res.status(401).json({ error: "Нет данных" });
  if (!["host", "co-host"].includes(pRows[0].role)) return res.status(403).json({ error: "Только ведущий" });

  const { snapshot } = req.body;
  if (!snapshot) return res.status(400).json({ error: "Пустой снапшот" });

  await db.update(meetingsTable).set({ whiteboardSnapshot: JSON.stringify(snapshot) })
    .where(eq(meetingsTable.meetingId, req.params.meetingId));
  broadcastToMeeting(parsed.meetingId, { type: "whiteboard_update", snapshot });
  return res.json({ ok: true });
});

/* ──────────────────────────────────────────────────
 * GET /api/meetings/:meetingId/participants — список участников с ролями
 * ────────────────────────────────────────────────── */
router.get("/meetings/:meetingId/participants", async (req, res) => {
  const token = req.headers["x-participant-token"] as string;
  if (!token) return res.status(401).json({ error: "Нет токена" });
  const parsed = verifyParticipantToken(token);
  if (!parsed || parsed.meetingId !== req.params.meetingId) return res.status(401).json({ error: "Недействителен" });

  const rows = await db.select().from(meetingParticipantsTable)
    .where(eq(meetingParticipantsTable.meetingId, req.params.meetingId));
  return res.json({ participants: rows });
});

export default router;
