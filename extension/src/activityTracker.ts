import * as vscode from "vscode";
import type { PresenceStatus } from "@presence/protocol";
import { ACTIVITY_POLL_MS, IDLE_AFTER_MS } from "./constants";

/**
 * Reports active/idle transitions. Any editor interaction (or regaining window
 * focus) counts as activity; after {@link IDLE_AFTER_MS} without any, we flip
 * to idle. Only emits on a change, so it's cheap to wire to the network.
 */
export class ActivityTracker implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private timer?: NodeJS.Timeout;
  private lastActivity = Date.now();
  private idle = false;

  constructor(private readonly onChange: (status: PresenceStatus) => void) {}

  start(): void {
    const bump = () => {
      this.lastActivity = Date.now();
      this.recompute();
    };
    this.disposables.push(
      vscode.window.onDidChangeWindowState((s) => {
        if (s.focused) this.lastActivity = Date.now();
        this.recompute();
      }),
      vscode.window.onDidChangeActiveTextEditor(bump),
      vscode.window.onDidChangeTextEditorSelection(bump),
    );
    this.timer = setInterval(() => this.recompute(), ACTIVITY_POLL_MS);
  }

  private recompute(): void {
    const idle = Date.now() - this.lastActivity > IDLE_AFTER_MS;
    if (idle !== this.idle) {
      this.idle = idle;
      this.onChange(idle ? "idle" : "active");
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }
}
