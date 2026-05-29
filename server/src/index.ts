import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";

/** A teammate as seen in a room roster. */
interface User {
  id: string;
  name: string;
  file: string;
}

/** Messages the relay accepts from clients. */
type ClientMessage =
  | { type: "hello"; name: string; room: string; id?: string }
  | { type: "update"; file: string };

/** Messages the relay sends to clients. */
interface RosterMessage {
  type: "roster";
  users: User[];
}

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

const wss = new WebSocketServer({ port: PORT });

/** Send the current roster of `roomId` to every open socket in that room. */
function broadcast(roomId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  const msg: RosterMessage = { type: "roster", users: [...room.values()] };
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    const c = client as Conn;
    if (c.roomId === roomId && c.readyState === WebSocket.OPEN) {
      c.send(data);
    }
  }
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
      room.set(conn.id, { id: conn.id, name: msg.name, file: "" });
      broadcast(msg.room);
    } else if (msg.type === "update") {
      if (!conn.roomId) return; // update before hello — ignore
      const user = rooms.get(conn.roomId)?.get(conn.id);
      if (user) {
        user.file = msg.file;
        broadcast(conn.roomId);
      }
    }
  });

  conn.on("close", () => {
    if (!conn.roomId) return;
    const room = rooms.get(conn.roomId);
    if (!room) return;
    room.delete(conn.id);
    if (room.size === 0) {
      rooms.delete(conn.roomId);
    } else {
      broadcast(conn.roomId);
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
  console.log(`  ws://${ip}:${PORT}        (give this to teammates on your LAN)`);
}
