import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import type {
  ClientMessage,
  CommentsMessage,
  DiffFile,
  DiffsMessage,
  RosterMessage,
  User,
} from "@presence/protocol";
import { applyCommentOp, type CommentStore } from "./comments";

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
// roomId -> comment threads. Threads outlive their authors (and the diff
// owner) and are dropped only when the room empties.
const comments = new Map<string, CommentStore>();

const wss = new WebSocketServer({ port: PORT });

/**
 * Timestamped console line. We log lifecycle events (connects, joins, leaves,
 * room churn) and a bare signal that updates/diffs/comments arrived — never
 * their contents (file paths, branches, diff or comment bodies), keeping the
 * relay's in-memory, low-PII posture intact.
 */
function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

/**
 * Human-friendly label for a connection: the user's display name (with the id
 * in parens to disambiguate) once we've seen their `hello`, otherwise the bare
 * id. Names come from the roster, so this only resolves while the user is still
 * a member of the room — capture it before removing them on disconnect.
 */
function label(conn: Conn): string {
  const name = conn.roomId && rooms.get(conn.roomId)?.get(conn.id)?.name;
  return name ? `${name} (${conn.id})` : conn.id;
}

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

/** Send every comment thread in `roomId` to everyone in that room. */
function broadcastComments(roomId: string): void {
  const store = comments.get(roomId);
  const threads = store ? [...store.values()] : [];
  const msg: CommentsMessage = { type: "comments", threads };
  const data = JSON.stringify(msg);
  sendToRoom(roomId, data);
}

wss.on("connection", (socket) => {
  const conn = socket as Conn;
  conn.id = randomUUID();
  conn.isAlive = true;
  log(`connection opened (${conn.id})`);

  conn.on("pong", () => {
    conn.isAlive = true;
  });

  conn.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      log(`dropped malformed frame from ${conn.id}`);
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
        log(`room created (${msg.room})`);
      }
      log(`${msg.name} (${conn.id}) joined room ${msg.room}`);
      room.set(conn.id, {
        id: conn.id,
        name: msg.name,
        file: "",
        branch: "",
        status: "active",
      });
      broadcast(msg.room);
      // Hand the newcomer everyone's diffs and comments (and vice-versa).
      broadcastDiffs(msg.room);
      broadcastComments(msg.room);
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
        log(`update from ${label(conn)} in ${conn.roomId}`);
        broadcast(conn.roomId);
      }
    } else if (msg.type === "diff") {
      if (!conn.roomId) return; // diff before hello — ignore
      let room = diffs.get(conn.roomId);
      if (!room) {
        room = new Map();
        diffs.set(conn.roomId, room);
      }
      const files = Array.isArray(msg.files) ? msg.files : [];
      room.set(conn.id, files);
      log(`diff from ${label(conn)} in ${conn.roomId} (${files.length} files)`);
      broadcastDiffs(conn.roomId);
    } else if (msg.type === "comment") {
      if (!conn.roomId) return; // comment before hello — ignore
      const author = rooms.get(conn.roomId)?.get(conn.id);
      if (!author) return;
      let store = comments.get(conn.roomId);
      if (!store) {
        store = new Map();
        comments.set(conn.roomId, store);
      }
      const changed = applyCommentOp(store, author, msg);
      if (!changed) return;
      const who = label(conn);
      log(`comment ${msg.op} from ${who} in ${conn.roomId}`);
      broadcastComments(conn.roomId);
    }
  });

  conn.on("close", () => {
    // Resolve the name before we remove the user from the roster below.
    const who = label(conn);
    log(`connection closed (${who})`);
    if (!conn.roomId) return;
    const room = rooms.get(conn.roomId);
    if (room) {
      room.delete(conn.id);
      log(`${who} left room ${conn.roomId}`);
      if (room.size === 0) {
        rooms.delete(conn.roomId);
        comments.delete(conn.roomId);
        log(`room emptied (${conn.roomId})`);
      } else broadcast(conn.roomId);
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
      log(`terminating unresponsive connection (${label(c)})`);
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
