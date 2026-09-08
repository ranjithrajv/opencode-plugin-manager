# opencode-plugin-manager

An [OpenCode](https://opencode.ai) sidebar section listing **plugins** with
installed/uninstalled status — placed below the built-in MCP section and the
Skills list, mirroring the built-in sidebar widgets.

## What it shows

- **Installed plugins** from the plugin registry (same list
  `opencode2 plugin list` shows; built-ins excluded) with their activation
  state: `✓ active`, `✗ failed`, `○ inactive`.
- **LOCAL group** mixes registered plugins (`✓ … installed`) with workspace
  plugin projects discovered by scanning the workspace root for sibling
  directories whose `package.json` depends on `@opencode-ai/plugin` (private
  monorepo roots and shared libraries excluded) — those show dimmed with
  `○ … uninstalled` and a `[+]` to register them, same status column as
  everything else.
- **Built-in plugins** are listed by default (group collapsed to keep the
  sidebar short) and can be hidden/shown with **`/plugins-builtins`** — a view
  toggle only, persisted; built-ins always run. They can't be disabled
  individually: the runtime has no per-built-in disable mechanism — the only
  switch is the all-or-nothing `OPENCODE_DISABLE_DEFAULT_PLUGINS` env var,
  whose state the widget shows when the BUILT-IN group is visible. Per-built-in
  disable requires upstream support in OpenCode's plugin host.
- **Plugin descriptions** — the registry exposes no human metadata, so the
  plugin ships its own catalog (`builtins.ts`): curated descriptions for
  well-known built-ins plus per-category generation (`provider.*`, `tool.*`,
  `config.*`, `websearch.*`). Click any row to inspect its details.

Collapsed header shows `PLUGINS (installed/total)`; more than two entries
collapse, click (or expand) to list them — same interaction as the built-in
MCP/Skills sections.

## Install

```sh
# in opencode.jsonc
{ "plugins": ["./opencode-usage-quota-tracker", "./opencode-skill-lister", "./opencode-plugin-manager", "./opencode-model-recommender"] }
```

Order matters: plugins sharing the `sidebar.content` slot render in
`plugins` array order — keep this entry after `opencode-skill-lister` (and
before anything you want below it) so the section sits directly under
**MCP** and **Skills**.

## Data sources

- Plugin registry: `client.plugin.list()` (activation state included)
- Workspace scan: sibling directories of the current location, one
  `package.json` read per candidate; result is cached through
  [opencode-plugin-kit](../opencode-plugin-kit)'s `createCachedStore` so the
  sidebar restores instantly after a TUI restart.

## License

GNU Affero General Public License v3.0 — see [LICENSE](LICENSE).
