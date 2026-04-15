import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { attachCallSignaling } from "./lib/callSignaling";
import { attachMeetingChatWs } from "./lib/meetingChatWs";
import { db, accountsTable, sessionsTable, broadcastsTable, broadcastCommentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/*
 * ONE-TIME МИГРАЦИИ (идемпотентны — безопасно запускать многократно)
 *
 * История: у пользователя "ДАН МАЛИ" было два аккаунта:
 *   OLD = cbf476db... (старый, создан через устаревший /api/sessions без Ed25519)
 *   NEW = 20e0dbfa... (рабочий, create через Ed25519, тема tokyo/silk)
 * Гость видел профиль OLD → синий дефолт вместо реального дизайна.
 *
 * Миграция 1: удаляем дублирующий аккаунт OLD из accounts и sessions
 * Миграция 2: переносим broadcasts и комментарии с OLD → NEW
 *   (посты были созданы когда пользователь был залогинен как OLD)
 */
const OLD_HASH = "cbf476db46b1b092d4947493fe527ee1ba62d62286fb4e44684aad07790fc907";
const NEW_HASH = "20e0dbfaa350282ecb2cdc1931a43d0c3d3a05ab523540742df91813affb4a3d";

(async () => {
  /* ── Миграция 1: удалить дублирующий аккаунт ── */
  try {
    await db.delete(sessionsTable).where(eq(sessionsTable.userHash, OLD_HASH));
    await db.delete(accountsTable).where(eq(accountsTable.hash, OLD_HASH));
    logger.info({ hash: OLD_HASH.slice(0,16) }, "MIG-1: duplicate account cleaned");
  } catch (e) {
    logger.warn({ err: e }, "MIG-1: skipped (already done or error)");
  }

  /* ── Миграция 2: перенести broadcasts OLD → NEW ── */
  try {
    const moved = await db
      .update(broadcastsTable)
      .set({ authorHash: NEW_HASH })
      .where(eq(broadcastsTable.authorHash, OLD_HASH));
    logger.info({ count: moved.rowCount ?? 0, from: OLD_HASH.slice(0,16), to: NEW_HASH.slice(0,16) },
      "MIG-2: broadcasts transferred to new account");
  } catch (e) {
    logger.warn({ err: e }, "MIG-2: broadcasts transfer skipped");
  }

  /* ── Миграция 3: перенести комментарии OLD → NEW ── */
  try {
    const moved = await db
      .update(broadcastCommentsTable)
      .set({ authorHash: NEW_HASH })
      .where(eq(broadcastCommentsTable.authorHash, OLD_HASH));
    logger.info({ count: moved.rowCount ?? 0 }, "MIG-3: comments transferred to new account");
  } catch (e) {
    logger.warn({ err: e }, "MIG-3: comments transfer skipped");
  }
})();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = http.createServer(app);

attachCallSignaling(httpServer);
attachMeetingChatWs(httpServer);

httpServer.on("error", (err) => {
  logger.error({ err }, "Error starting server");
  process.exit(1);
});

httpServer.listen(port, () => {
  logger.info({ port }, "Server listening (HTTP + WebSocket /ws/calls)");
});
