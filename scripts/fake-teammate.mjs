// Dev helper: connect to the relay as a simulated teammate so you can test
// presence with a single real VS Code window.
//
// Usage:
//   node scripts/fake-teammate.mjs <repo-path> [name] [file]
//
//   <repo-path>  Path to the SAME repo you opened in VS Code. Used to derive
//                the room id exactly like the extension does (git remote, else
//                folder name).
//   [name]       Display name to show. Default: "Robot".
//   [file]       File to report. Default: cycles through a few paths so you can
//                watch the roster update live.
//
// Point this at the same server (ws://localhost:8080 by default, or set
// SERVER_URL / PORT).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";

// Reuse the `ws` already installed in the server package.
const require = createRequire(import.meta.url);
const WebSocket = require(
  path.join(import.meta.dirname, "..", "server", "node_modules", "ws"),
);

const repoPath = process.argv[2];
const name = process.argv[3] || "Robot";
const fixedFile = process.argv[4];

if (!repoPath) {
  console.error(
    "usage: node scripts/fake-teammate.mjs <repo-path> [name] [file]",
  );
  process.exit(1);
}

const url =
  process.env.SERVER_URL || `ws://localhost:${process.env.PORT || 8080}`;

const shortHash = (v) =>
  createHash("sha1").update(v).digest("hex").slice(0, 12);

function resolveRoomId(repo) {
  try {
    const remote = execFileSync(
      "git",
      ["config", "--get", "remote.origin.url"],
      {
        cwd: repo,
        stdio: ["ignore", "pipe", "ignore"],
      },
    )
      .toString()
      .trim();
    if (remote) return shortHash(remote);
  } catch {
    // no git remote — fall through
  }
  return shortHash(`folder:${path.basename(path.resolve(repo))}`);
}

const room = resolveRoomId(repoPath);
console.log(`connecting to ${url} as "${name}" in room ${room}`);

const cycle = ["src/index.ts", "README.md", "src/extension.ts", "package.json"];
let i = 0;

const ws = new WebSocket(url);

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "hello", name, room }));
  const send = (file) => {
    ws.send(JSON.stringify({ type: "update", file }));
    console.log(`-> update: ${file}`);
  };
  if (fixedFile) {
    send(fixedFile);
  } else {
    send(cycle[i++ % cycle.length]);
    setInterval(() => send(cycle[i++ % cycle.length]), 3000);
  }
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "roster") {
    console.log(
      "<- roster:",
      msg.users.map((u) => `${u.name}:${u.file || "-"}`).join(", "),
    );
  }
});

ws.on("close", () => {
  console.log("disconnected");
  process.exit(0);
});
ws.on("error", (e) => console.error("error:", e.message));
