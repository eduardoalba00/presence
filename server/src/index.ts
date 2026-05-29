import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import type {
  ClientMessage,
  DiffFile,
  DiffsMessage,
  RosterMessage,
  User,
} from "@presence/protocol";

/** A live socket, annotated with the bits of state we track per connection. */
interface Conn extends WebSocket {
  id: string;
  roomId?: string;
  isAlive: boolean;
}

const PORT = Number(process.env.PORT) || 8080;
const HEARTBEAT_MS = 30_000;

// roomId -> (connectionId -> User). In-memory only; nothing is persisted.
const rooms = new Map<string, Map<string, User>>();
// roomId -> (connectionId -> their changed files). Independent of the roster
// because diffs change on a different (debounced) cadence than file switches.
const diffs = new Map<string, Map<string, DiffFile[]>>();

const wss = new WebSocketServer({ port: PORT });

/** Send `data` to every open socket in `roomId`. */
function sendToRoom(roomId: string, data: string): void {
  for (const client of wss.clients) {
    const c = client as Conn;
    if (c.roomId === roomId && c.readyState === WebSocket.OPEN) {
      c.send(data);
    }
  }
}

/** Send the current roster of `roomId` to everyone in that room. */
function broadcast(roomId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  const msg: RosterMessage = { type: "roster", users: [...room.values()] };
  sendToRoom(roomId, JSON.stringify(msg));
}

/** Send everyone's current diffs in `roomId` to everyone in that room. */
function broadcastDiffs(roomId: string): void {
  const room = diffs.get(roomId);
  const entries = room
    ? [...room.entries()].map(([id, files]) => ({ id, files }))
    : [];
  const msg: DiffsMessage = { type: "diffs", entries };
  sendToRoom(roomId, JSON.stringify(msg));
}

wss.on("connection", (socket) => {
  const conn = socket as Conn;
  conn.id = randomUUID();
  conn.isAlive = true;

  conn.on("pong", () => {
    conn.isAlive = true;
  });

  conn.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // ignore malformed frames
    }

    if (msg.type === "hello") {
      // Prefer the client-supplied id so a client can recognize itself in the
      // roster (and survive reconnects); fall back to the generated one.
      if (typeof msg.id === "string" && msg.id) conn.id = msg.id;
      conn.roomId = msg.room;
      let room = rooms.get(msg.room);
      if (!room) {
        room = new Map();
        rooms.set(msg.room, room);
      }
      room.set(conn.id, {
        id: conn.id,
        name: msg.name,
        file: "",
        branch: "",
        status: "active",
      });
      broadcast(msg.room);
      // Hand the newcomer everyone's current diffs (and vice-versa).
      broadcastDiffs(msg.room);
    } else if (msg.type === "update") {
      if (!conn.roomId) return; // update before hello — ignore
      const user = rooms.get(conn.roomId)?.get(conn.id);
      if (user) {
        // Merge only the fields present in this partial update.
        if (typeof msg.file === "string") user.file = msg.file;
        if (typeof msg.branch === "string") user.branch = msg.branch;
        if (msg.status === "active" || msg.status === "idle") {
          user.status = msg.status;
        }
        broadcast(conn.roomId);
      }
    } else if (msg.type === "diff") {
      if (!conn.roomId) return; // diff before hello — ignore
      let room = diffs.get(conn.roomId);
      if (!room) {
        room = new Map();
        diffs.set(conn.roomId, room);
      }
      room.set(conn.id, Array.isArray(msg.files) ? msg.files : []);
      broadcastDiffs(conn.roomId);
    }
  });

  conn.on("close", () => {
    if (!conn.roomId) return;
    const room = rooms.get(conn.roomId);
    if (room) {
      room.delete(conn.id);
      if (room.size === 0) rooms.delete(conn.roomId);
      else broadcast(conn.roomId);
    }
    const diffRoom = diffs.get(conn.roomId);
    if (diffRoom?.delete(conn.id)) {
      if (diffRoom.size === 0) diffs.delete(conn.roomId);
      // Broadcast either way so remaining teammates drop the departed diff
      // (when the room is now empty, this sends an empty entries list).
      broadcastDiffs(conn.roomId);
    }
  });

  conn.on("error", () => {
    // A `close` event always follows; cleanup happens there.
  });
});

// Heartbeat: drop connections that stop responding to pings.
const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    const c = client as Conn;
    if (!c.isAlive) {
      c.terminate();
      continue;
    }
    c.isAlive = false;
    c.ping();
  }
}, HEARTBEAT_MS);

wss.on("close", () => clearInterval(heartbeat));

/** Non-internal IPv4 addresses, so teammates know what URL to point at. */
function lanAddresses(): string[] {
  const addrs: string[] = [];
  for (const iface of Object.values(networkInterfaces())) {
    for (const info of iface ?? []) {
      if (info.family === "IPv4" && !info.internal) addrs.push(info.address);
    }
  }
  return addrs;
}

console.log(`presence relay listening on:`);
console.log(`  ws://localhost:${PORT}            (this machine)`);
for (const ip of lanAddresses()) {
  console.log(
    `  ws://${ip}:${PORT}        (give this to teammates on your LAN)`,
  );
}
