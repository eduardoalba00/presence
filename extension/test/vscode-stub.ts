/**
 * Minimal `vscode` stand-in for unit tests.
 *
 * The modules under test (`config.ts`, `util/paths.ts`) import the real VS Code
 * API, but the pure functions we cover here never touch it at runtime — so
 * these no-op shims only need to exist for `import * as vscode from "vscode"`
 * to resolve under Vitest. If a test starts exercising a vscode-backed code
 * path, give the relevant member real behavior here.
 */

export const workspace = {};
export const window = {};
export const commands = {};
export const extensions = {};
export const Uri = {};

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}
