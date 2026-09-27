# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/ranjithraj/opencode-plugin-manager/compare/v1.0.0-alpha.4...HEAD
[1.0.0-alpha.4]: https://github.com/ranjithraj/opencode-plugin-manager/releases/tag/v1.0.0-alpha.4
[0.1.0]: https://github.com/ranjithraj/opencode-plugin-manager/releases/tag/v0.1.0
