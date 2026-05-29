import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      include: ["extension/src/**", "protocol/src/**", "server/src/**"],
    },
  },
  resolve: {
    alias: {
      // Extension modules import the `vscode` API, which only exists inside the
      // editor host. Our unit tests exercise the *pure* logic in those modules,
      // so this stub just lets the imports resolve. If a test starts driving a
      // vscode-backed path, add the needed surface to extension/test/vscode-stub.ts.
      vscode: fileURLToPath(
        new URL("./extension/test/vscode-stub.ts", import.meta.url),
      ),
    },
  },
});
