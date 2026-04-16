import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { createHmac } from "node:crypto";

const SECRET = process.env.SESSION_SECRET || "fallback-dev-secret-change-in-prod";

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

interface RoomClient {
  ws: WebSocket;
  participantId: string;
  meetingId: string;
}

/* meetingId → Set<RoomClient> */
const rooms = new Map<string, Set<RoomClient>>();

function broadcast(meetingId: string, payload: object, excludeId?: string) {
  const room = rooms.get(meetingId);
  if (!room) return;
  const msg = JSON.stringify(payload);
  for (const client of room) {
    if (client.participantId === excludeId) continue;
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(msg);
    }
  }
}

export function broadcastToMeeting(meetingId: string, payload: object) {
  broadcast(meetingId, payload);
}

export function kickParticipantWs(meetingId: string, participantId: string) {
  const room = rooms.get(meetingId);
  if (!room) return;
  for (const client of room) {
    if (client.participantId === participantId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({ type: "participant_kicked", participantId }));
      setTimeout(() => client.ws.close(4003, "kicked"), 200);
    }
  }
  broadcast(meetingId, { type: "participant_left", participantId });
}

export function attachMeetingChatWs(httpServer: Server) {
  const wss = new WebSocketServer({ server: httpServer, path: "/api/ws/meeting-chat" });

  /* Heartbeat */
  const heartbeat = setInterval(() => {
    wss.clients.forEach(ws => {
      if ((ws as any)._dead) { ws.terminate(); return; }
      (ws as any)._dead = true;
      ws.ping();
    });
  }, 25_000);
  wss.on("close", () => clearInterval(heartbeat));

  wss.on("connection", (ws: WebSocket, req) => {
    const url = new URL(req.url || "", "http://x");
    const token = url.searchParams.get("token") || "";

    const parsed = verifyParticipantToken(token);
    if (!parsed) { ws.close(4001, "invalid token"); return; }

    const { participantId, meetingId } = parsed;

    const client: RoomClient = { ws, participantId, meetingId };
    if (!rooms.has(meetingId)) rooms.set(meetingId, new Set());
    rooms.get(meetingId)!.add(client);

    ws.on("pong", () => { (ws as any)._dead = false; });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "ping") { ws.send(JSON.stringify({ type: "pong" })); return; }
        if (msg.type === "whiteboard_update") {
          broadcast(meetingId, { type: "whiteboard_update", snapshot: msg.snapshot }, participantId);
          return;
        }
        if (msg.type === "role_change") {
          broadcast(meetingId, { type: "role_change", targetId: msg.targetId, role: msg.role });
          return;
        }
        if (msg.type === "give_floor") {
          broadcast(meetingId, { type: "give_floor", targetId: msg.targetId, fromId: participantId });
          return;
        }
        if (msg.type === "floor_returned") {
          broadcast(meetingId, { type: "floor_returned", participantId });
          return;
        }
      } catch {}
    });

    ws.on("close", () => {
      const room = rooms.get(meetingId);
      if (room) {
        room.delete(client);
        if (room.size === 0) rooms.delete(meetingId);
      }
      broadcast(meetingId, { type: "participant_left", participantId });
    });

    ws.on("error", () => ws.terminate());

    broadcast(meetingId, { type: "participant_joined", participantId }, participantId);
    ws.send(JSON.stringify({ type: "connected", participantId, meetingId }));
  });
}
