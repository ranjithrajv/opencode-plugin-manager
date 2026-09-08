// Server-side entrypoint. All behavior (the sidebar plugins list) lives in
// the TUI entrypoint (tui.tsx), exposed via the "./tui" export. The server
// role must not import JSX — OpenCode's server transpiler resolves JSX with
// the default "react" runtime, which is not installed and fails the load.
import { Plugin } from "@opencode-ai/plugin"

// Hoisted into a named binding: a bare `export default <object expression>`
// produces empty v8 coverage maps for this file.
const plugin = Plugin.define({
  id: "plugin-manager.server",
  setup() {},
})

export { plugin }
export default plugin
