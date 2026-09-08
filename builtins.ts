// Descriptions for built-in OpenCode plugins. The registry (/api/plugin)
// exposes only id/source/state — no human metadata — so the plugin ships its
// own catalog. Categories (opencode.<category>.<name>) get generated
// descriptions; well-known plugins get curated overrides.

const OVERRIDES: Record<string, string> = {
  "opencode.agent": "Agent runtime: session agents, subagents, and agent state.",
  "opencode.browser": "Desktop browser integration for automation and page capture.",
  "opencode.command": "Command registry: slash commands and their execution wiring.",
  "opencode.mcp.codemode.exclusion": "Excludes MCP tools from code-mode execution where unsafe.",
  "opencode.models.dev": "models.dev catalog sync: model metadata and pricing.",
  "opencode.plan": "Plan mode: read-only planning sessions before execution.",
  "opencode.skill": "Skills runtime: discovers and exposes SKILL.md-based skills.",
  "opencode.tools": "Tool namespace: registers the core tool set for sessions.",
  "opencode.variant": "Model variant handling (provider-specific model settings).",
  "opencode.warming": "Warms providers/connections at startup for faster first use.",
  "opencode.wellknown": "Serves well-known endpoints for integrations and discovery.",
  "opencode.vcs.git": "Git integration: status, diffs, branches, worktrees.",
  "opencode.vcs.hg": "Mercurial integration: status, diffs, and branches.",
  "opencode.prompt.openai": "Prompt-shaping adaptations for OpenAI models.",
  "opencode.prompt.kimi": "Prompt-shaping adaptations for Kimi models.",
  "opencode.prompt.arcee": "Prompt-shaping adaptations for Arcee models.",
  "opencode.prompt.meta": "Prompt-shaping adaptations for Meta (Llama) models.",
}

const CATEGORIES: Record<string, (name: string) => string> = {
  provider: (n) => `Provider integration for ${n} (auth, API, model wiring).`,
  tool: (n) => `Core "${n}" tool implementation for agent sessions.`,
  config: (n) => `Loads and applies ${n} configuration into the runtime.`,
  websearch: (n) => `Web search backend (${n}) for the websearch tool.`,
}

/** Best-effort description for a built-in plugin id. */
export function describeBuiltin(id: string): string {
  const override = OVERRIDES[id]
  if (override) return override
  const parts = id.split(".")
  // Expect "opencode.<category>.<name...>"
  if (parts[0] === "opencode" && parts.length >= 3) {
    const category = parts[1]
    const name = parts.slice(2).join(" ")
    const gen = CATEGORIES[category]
    if (gen) return gen(name)
    return `Built-in ${category} plugin: ${name}.`
  }
  return "Built-in plugin."
}
