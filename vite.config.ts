import solid from "vite-plugin-solid"
import { defineConfig } from "vite-plus"

export default defineConfig({
  plugins: [
    solid({
      include: [/\.tsx$/, /opencode-plugin-kit\/src\/.+\.tsx$/],
      exclude: [/node_modules\/(?!opencode-plugin-kit)/],
    }),
  ],
  resolve: {
    alias: [{ find: /^solid-js$/, replacement: "solid-js/dist/solid.js" }],
    // The kit ships its own peer copies (solid-js, @opencode-ai/plugin);
    // dedupe forces the consumer's copies so context/signals are shared.
    dedupe: ["solid-js", "@opencode-ai/plugin", "@opencode-ai/plugin/tui", "@opentui/solid"],
    conditions: ["browser", "development"],
  },
  fmt: {
    semi: false,
    singleQuote: false,
    printWidth: 120,
    trailingComma: "all",
  },
  lint: {
    ignorePatterns: ["dist/**", "node_modules/**", "coverage/**"],
  },
  test: {
    environment: "happy-dom",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["index.ts", "tui.tsx"],
      thresholds: { lines: 100, functions: 100, statements: 100, branches: 100 },
    },
  },
  staged: {
    "*": "vp check --fix",
  },
})
