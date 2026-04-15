import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server } from "http";
import { db, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/* ─── Типы сообщений ─── */
type CallType = "audio" | "video";
interface WsMsg { type: string; [k: string]: any }

/* ─── Реестр подключённых пользователей: hash → ws ─── */
const online = new Map<string, WebSocket>();

async function resolveHash(token: string): Promise<string | null> {
  if (!token) return null;
  try {
    const rows = await db.select()
      .from(sessionsTable)
      .where(eq(sessionsTable.token, token))
      .limit(1);
    if (!rows.length) return null;
    const s = rows[0];
    if (new Date(s.expiresAt) < new Date()) return null;
    return s.userHash;
  } catch { return null; }
}

const PING_INTERVAL_MS = 25_000; // каждые 25 сек
const PONG_TIMEOUT_MS  = 10_000; // если нет ответа 10 сек — мёртвый

function send(ws: WebSocket, msg: WsMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function forwardTo(targetHash: string, msg: WsMsg): boolean {
  const ws = online.get(targetHash);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (ws) online.delete(targetHash); // убираем мёртвые
    return false;
  }
  send(ws, msg);
  return true;
}

export function attachCallSignaling(httpServer: Server) {
  const wss = new WebSocketServer({ server: httpServer, path: "/api/ws/calls" });

  /* ── Heartbeat: каждые 25 сек пингуем всех, убираем мёртвых ── */
  const heartbeat = setInterval(() => {
    for (const [hash, ws] of online) {
      if (ws.readyState !== WebSocket.OPEN) { online.delete(hash); continue; }
      // Отправляем ping и ждём pong — если нет, убиваем
      const dead = setTimeout(() => {
        online.delete(hash);
        ws.terminate();
      }, PONG_TIMEOUT_MS);
      ws.once('pong', () => clearTimeout(dead));
      ws.ping();
    }
  }, PING_INTERVAL_MS);

  wss.on("close", () => clearInterval(heartbeat));

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    let myHash: string | null = null;

    ws.on("message", async (raw) => {
      let msg: WsMsg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      /* ── Шаг 1: Аутентификация ── */
      if (msg.type === "register") {
        const hash = await resolveHash(msg.token || "");
        if (!hash) { send(ws, { type: "error", code: "auth", message: "Неверный токен" }); return; }
        myHash = hash;
        online.set(hash, ws);
        send(ws, { type: "registered", hash });
        return;
      }

      if (!myHash) { send(ws, { type: "error", code: "auth", message: "Сначала зарегистрируйтесь" }); return; }

      /* ── Исходящий звонок ── */
      if (msg.type === "call:request") {
        const { calleeHash, callType = "audio" } = msg;
        if (!calleeHash || calleeHash === myHash) return;

        /* Абонент не онлайн */
        if (!online.has(calleeHash)) {
          send(ws, { type: "call:unavailable", calleeHash });
          return;
        }

        forwardTo(calleeHash, { type: "call:incoming", callerHash: myHash, callType });
        send(ws, { type: "call:ringing", calleeHash });
        return;
      }

      /* ── Принять звонок ── */
      if (msg.type === "call:accept") {
        const { callerHash } = msg;
        forwardTo(callerHash, { type: "call:accepted", calleeHash: myHash });
        return;
      }

      /* ── Отклонить звонок ── */
      if (msg.type === "call:decline") {
        const { callerHash } = msg;
        forwardTo(callerHash, { type: "call:declined", calleeHash: myHash });
        return;
      }

      /* ── Завершить звонок ── */
      if (msg.type === "call:end") {
        const { peerHash } = msg;
        forwardTo(peerHash, { type: "call:ended", peerHash: myHash });
        return;
      }

      /* ── WebRTC SDP Offer ── */
      if (msg.type === "call:offer") {
        const { peerHash, sdp } = msg;
        forwardTo(peerHash, { type: "call:offer", callerHash: myHash, sdp });
        return;
      }

      /* ── WebRTC SDP Answer ── */
      if (msg.type === "call:answer") {
        const { peerHash, sdp } = msg;
        forwardTo(peerHash, { type: "call:answer", calleeHash: myHash, sdp });
        return;
      }

      /* ── WebRTC ICE candidate ── */
      if (msg.type === "call:ice") {
        const { peerHash, candidate } = msg;
        forwardTo(peerHash, { type: "call:ice", peerHash: myHash, candidate });
        return;
      }
    });

    ws.on("close", () => {
      if (myHash) {
        online.delete(myHash);
        myHash = null;
      }
    });

    ws.on("error", () => {
      if (myHash) { online.delete(myHash); myHash = null; }
    });
  });

  return wss;
}
