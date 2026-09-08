<!--
CHANGELOG ENTRY TEMPLATE
========================
Copy the block below into CHANGELOG.md under `## [Unreleased]` for every
release, then fill it in. Rules:

- Headings map 1:1 from Conventional Commits — a release notes diff should be
  a group-by of commit types:
    feat   -> Added       fix -> Fixed   perf -> Changed
    refactor -> Changed   deprecate -> Deprecated   remove -> Removed
    security -> Security
  `docs:` and `chore:` commits do NOT get bullets here unless user-visible
  (a README rewrite that changes documented behavior is a `Changed` bullet).
- Audience check before adding a bullet: would a plugin *user* care? If only
  developers care, leave it out (or fold it into a `Changed` line like
  "internal refactor, no behavior change").
- Every bullet: what changed + why it matters, in that order. Reference the
  upstream issue/PR number where one exists (e.g. `(#42)`).
- Breaking changes get a `### Breaking` block at the top of the release, and
  the version bump is major.

TEMPLATE — copy from here -------------------------------------------------
-->

## [Unreleased]

<!--
### Breaking

- …

### Added
- …

### Changed
- …

### Deprecated
- …

### Removed
- …

### Fixed
- …

### Security
- …
-->

<!--
TEMPLATE — copy to here ----------------------------------------------------

Link footers (update the version pins on release):

[Unreleased]: https://github.com/ranjithraj/opencode-plugin-manager/compare/vX.Y.Z...HEAD
[X.Y.Z]: https://github.com/ranjithraj/opencode-plugin-manager/releases/tag/vX.Y.Z
-->
