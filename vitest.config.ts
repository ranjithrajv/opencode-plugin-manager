import path from "node:path"
import solid from "vite-plugin-solid"
import { defineConfig } from "vitest/config"

// The kit is installed from the registry with its own node_modules; without
// dedupe it would load a second solid-js instance and a second plugin context.
const root = path.dirname(new URL(import.meta.url).pathname)

export default defineConfig({
  plugins: [
    solid({
      hot: false,
      // The kit ships TypeScript source; transform its .tsx too, and keep
      // every other node_modules package excluded.
      include: [/\.tsx$/, /opencode-plugin-kit\/src\/.+\.tsx$/],
      exclude: [/node_modules\/(?!opencode-plugin-kit)/],
    }),
  ],
  resolve: {
    alias: [
      { find: /^solid-js$/, replacement: path.join(root, "node_modules/solid-js/dist/dev.js") },
      { find: /^solid-js\/web$/, replacement: path.join(root, "node_modules/solid-js/web/dist/dev.js") },
    ],
    conditions: ["browser", "development"],
    dedupe: ["solid-js", "@opencode/plugin", "@opencode/plugin/tui", "@opentui/solid"],
  },
  test: {
    environment: "happy-dom",
    // The kit ships TypeScript source, so inline it or a registry install
    // would be externalized and fail to load.
    server: { deps: { inline: [/opencode-plugin-kit/] } },
    include: ["**/*.test.ts", "**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["index.ts", "tui.tsx"],
      thresholds: { lines: 100, functions: 100, statements: 100, branches: 100 },
    },
  },
})
