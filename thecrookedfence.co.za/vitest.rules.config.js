import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "firebase/compat/database/dist/index.mjs": fileURLToPath(
        new URL("./node_modules/firebase/compat/database/dist/index.cjs.js", import.meta.url)
      ),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/rules/**/*.test.js"],
  },
});
