import WebSocket from "ws";
import type {
  ClientMessage,
  DiffEntry,
  DiffFile,
  PresenceStatus,
  ServerMessage,
  User,
} from "@presence/protocol";
import { RECONNECT_MAX_DELAY_MS } from "./constants";

export type ConnectionState = "connecting" | "connected" | "reconnecting";

/** Callbacks the controller supplies to react to server traffic. */
export interface PresenceClientHandlers {
  onRoster(users: User[]): void;
  onDiffs(entries: DiffEntry[]): void;
  onStatus(state: ConnectionState): void;
}

/**
 * Owns the connection to the relay: announces presence on (re)connect, streams
 * partial updates, and reconnects with capped exponential backoff. It retains
 * the latest presence state so it can re-announce in full after a drop.
 */
export class PresenceClient {
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private attempt = 0;
  private disposed = false;
  private everConnected = false;
  private diff: DiffFile[] = [];
  private meta: { file: string; branch: string; status: PresenceStatus } = {
    file: "",
    branch: "",
    status: "active",
  };

  private paused = false;

  constructor(
    private url: string,
    private readonly id: string,
    private readonly name: string,
    private readonly room: string,
    private readonly handlers: PresenceClientHandlers,
  ) {}

  start(): void {
    this.connect();
  }

  /** Stop sharing: drop the socket so teammates no longer see us. Retains state. */
  pause(): void {
    this.paused = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.ws?.close();
    this.ws = undefined;
  }

  /** Resume sharing after a pause; re-announces our retained presence state. */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.connect();
  }

  /** Point at a different relay, reconnecting immediately (unless paused). */
  changeUrl(url: string): void {
    if (url === this.url) return;
    this.url = url;
    if (this.paused) return; // the new url is used on resume
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.attempt = 0;
    this.ws?.close();
    this.ws = undefined;
    this.connect();
  }

  updateFile(file: string): void {
    this.meta.file = file;
    this.send({ type: "update", file });
  }

  updateBranch(branch: string): void {
    this.meta.branch = branch;
    this.send({ type: "update", branch });
  }

  updateStatus(status: PresenceStatus): void {
    this.meta.status = status;
    this.send({ type: "update", status });
  }

  updateDiff(files: DiffFile[]): void {
    this.diff = files;
    this.send({ type: "diff", files });
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.ws?.close();
    this.ws = undefined;
  }

  private connect(): void {
    if (this.disposed || this.paused) return;
    this.handlers.onStatus(this.everConnected ? "reconnecting" : "connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.on("open", () => this.handleOpen());
    ws.on("message", (raw) => this.handleMessage(raw));
    ws.on("close", () => this.scheduleReconnect());
    ws.on("error", () => {
      // A `close` event always follows; reconnect is scheduled there.
    });
  }

  private handleOpen(): void {
    this.attempt = 0;
    this.everConnected = true;
    this.handlers.onStatus("connected");
    // Re-announce ourselves and our full presence state on every (re)connect.
    this.send({ type: "hello", id: this.id, name: this.name, room: this.room });
    this.send({ type: "update", ...this.meta });
    this.send({ type: "diff", files: this.diff });
  }

  private handleMessage(raw: WebSocket.RawData): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw.toString()) as ServerMessage;
    } catch {
      return; // ignore malformed frames
    }
    if (msg.type === "roster" && Array.isArray(msg.users)) {
      this.handlers.onRoster(msg.users);
    } else if (msg.type === "diffs" && Array.isArray(msg.entries)) {
      this.handlers.onDiffs(msg.entries);
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.paused || this.reconnectTimer) return;
    this.handlers.onStatus("reconnecting");
    // Exponential backoff capped at the ceiling: 1, 2, 4, 8, 16, 30, 30, ...
    const delay = Math.min(1000 * 2 ** this.attempt, RECONNECT_MAX_DELAY_MS);
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }

  private send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
