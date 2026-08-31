import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["backend/**/*.test.ts", "frontend/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@verifystack/backend": path.resolve(root, "./backend"),
      "@": path.resolve(root, "./frontend"),
      // The React `react-server` condition is not active under Vitest, so the
      // real entry point would throw. Point at the package's no-op module.
      "server-only": path.resolve(root, "./node_modules/server-only/empty.js"),
    },
  },
});
