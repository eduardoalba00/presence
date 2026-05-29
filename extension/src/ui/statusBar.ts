import * as vscode from "vscode";
import { FOCUS_VIEW_COMMAND } from "../constants";
import type { ConnectionState } from "../presenceClient";

/** A status-bar item reflecting the connection state, online count, or paused. */
export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private state: ConnectionState = "connecting";
  private online = 0;
  private paused = false;
  private accessDenied = false;

  constructor(private url: string) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.item.name = "Presence";
    this.item.command = FOCUS_VIEW_COMMAND;
    this.render();
    this.item.show();
  }

  setState(state: ConnectionState): void {
    this.state = state;
    this.render();
  }

  setOnline(count: number): void {
    this.online = count;
    this.render();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.render();
  }

  /** Reflect that repo access could not be confirmed; clears on a granted retry. */
  setAccessDenied(denied: boolean): void {
    this.accessDenied = denied;
    this.render();
  }

  setUrl(url: string): void {
    this.url = url;
    this.render();
  }

  private render(): void {
    const item = this.item;
    if (this.accessDenied) {
      item.text = `$(error) Presence: no repo access`;
      item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.errorBackground",
      );
      item.tooltip =
        "Couldn't confirm you have access to this repository — Presence is disabled.";
      return;
    }
    if (this.paused) {
      item.text = `$(debug-pause) Presence: paused`;
      item.backgroundColor = undefined;
      item.tooltip = "Presence is paused — click to open the Teammates view";
      return;
    }
    switch (this.state) {
      case "connected":
        item.text = `$(broadcast) Presence: ${this.online > 0 ? `${this.online} online` : "just you"}`;
        item.backgroundColor = undefined;
        item.tooltip = `Connected to ${this.url}`;
        break;
      case "connecting":
        item.text = `$(loading~spin) Presence: connecting…`;
        item.backgroundColor = undefined;
        item.tooltip = `Connecting to ${this.url}`;
        break;
      case "reconnecting":
        item.text = `$(warning) Presence: reconnecting…`;
        item.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.warningBackground",
        );
        item.tooltip = `Lost connection to ${this.url} — retrying`;
        break;
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
