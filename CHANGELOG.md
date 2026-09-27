# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0-alpha.5] - 2026-09-27

### Fixed

- `@opencode/plugin` is now a real dependency instead of a peer. The plugin
  calls `Plugin.define()`, which is a runtime function, so a peer-only
  declaration left `@opencode/plugin` uninstalled — installing this package
  produced a plugin that failed to load with `Cannot find module
'@opencode/plugin'`. Pinned to `^2.0.15` so the host the runtime provides is
  the one that gets used.
- `opencode-plugin-kit` moved to `dependencies` for the same reason: it is
  imported at runtime, not just for types.
- `solid-js` moved from a peer to a dependency: `tui.tsx` imports `For`/`Show`
  from it directly, and the kit's barrel export pulls in its signal primitives.

## [1.0.0-alpha.4] - 2026-09-27

### Breaking

- Requires an OpenCode v2 host. The TUI/context types moved from the legacy
  `@opencode-ai/plugin` package to `@opencode/plugin@^2.0.15`, so this plugin
  no longer loads on a v1 runtime.

### Changed

- Sidebar rendering and keymap wiring use the v2 `ui.slot` / `keymap.layer`
  contract. The sidebar slot is claimed first and anchored above
  `sidebar.footer` so the list is always visible.
- Moved to the v2 host plugin API via `opencode-plugin-kit@^1.0.0-alpha.6`,
  which reads connected providers from the host's integration list instead of
  scraping `auth.json`.

## [0.1.0] - 2026-09-08

### Added

- Sidebar section listing OpenCode plugins with installed/uninstalled status
- Plugin install/uninstall/toggle via UI
- Grouped display (npm / local / built-in / uninstalled) with collapsible sections

[Unreleased]: https://github.com/ranjithraj/opencode-plugin-manager/compare/v1.0.0-alpha.5...HEAD
[1.0.0-alpha.5]: https://github.com/ranjithraj/opencode-plugin-manager/releases/tag/v1.0.0-alpha.5
[1.0.0-alpha.4]: https://github.com/ranjithraj/opencode-plugin-manager/releases/tag/v1.0.0-alpha.4
[0.1.0]: https://github.com/ranjithraj/opencode-plugin-manager/releases/tag/v0.1.0
