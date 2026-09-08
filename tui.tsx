/** @jsxImportSource @opentui/solid */
import { Plugin, usePlugin } from "@opencode-ai/plugin/tui"
import { createSignal, For, Show } from "solid-js"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import {
  asArray,
  createCachedResource,
  createCachedStore,
  createToggle,
  showToast,
  workspaceDirectory,
  type Toggle,
} from "opencode-plugin-kit"
import { CollapsibleGroup, CollapsibleSection } from "opencode-plugin-kit/collapsible"
import { describeBuiltin } from "./builtins.js"

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

type Kind = "npm" | "local" | "builtin"

interface Entry {
  name: string
  kind: Kind
  /** Project dir (local + uninstalled workspace candidates). */
  dir?: string
  /** npm version, when known. */
  version?: string
  /** npm registry reports an update available. */
  outdated?: boolean
  /** Activation state from the plugin registry ("active"/"failed"/…). */
  status?: string
  /** Description from the project's package.json (local plugins). */
  description?: string
  /** Known from config but not seen by the server registry (TUI-only). */
  configOnly?: boolean
}

export const GROUP_ORDER: Kind[] = ["npm", "local", "builtin"]

// Groups that start collapsed (built-ins are numerous). npm and local open.
export const DEFAULT_COLLAPSED: Partial<Record<Kind, boolean>> = {
  builtin: true,
}

// A directory is a plugin project when its package.json depends on the
// OpenCode plugin API and isn't a private monorepo root or the shared kit
// library (which has no plugin dependency).
export function isPluginProject(dir: string): { name: string; description?: string } | null {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
    if (pkg.private === true) return null
    const deps = {
      ...pkg.dependencies,
      ...pkg.peerDependencies,
    }
    if ("@opencode-ai/plugin" in deps) {
      return {
        name: String(pkg.name ?? basename(dir)),
        description: pkg.description ? String(pkg.description) : undefined,
      }
    }
  } catch {
    // Not a readable package.json — not a plugin project.
  }
  return null
}

// Scan the workspace root (the location's directory) for sibling plugin
// projects. This is the "known plugins" universe beyond the registry:
// anything here that isn't installed shows up as uninstalled.
export function scanWorkspace(root: string): Entry[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
      .map((d) => join(root, d.name))
      .filter((dir) =>
        statSync(join(dir, "package.json"), {
          throwIfNoEntry: false,
        })?.isFile(),
      )
      .map((dir) => ({ meta: isPluginProject(dir), dir }))
      .filter((e) => e.meta)
      .map(({ meta, dir }) => ({
        name: meta!.name,
        dir,
        kind: "local" as const,
        status: "uninstalled",
        description: meta!.description,
      }))
  } catch {
    return []
  }
}

// Strip a trailing npm version from a specifier without touching scoped
// names: "pkg@1.2" → "pkg", "@scope/pkg@1.2" → "@scope/pkg", "@scope/pkg" →
// unchanged.
export function stripVersion(spec: string): string {
  const m = spec.match(/^(.+[^@])@([^@]+)$/)
  return m ? m[1] : spec
}

// A config `plugins` entry is either a local path ("./x", "/abs/x") or a
// package specifier ("pkg", "@scope/pkg", "pkg@1.2", a git URL).
export function configEntry(entry: string, docDir: string): Entry | null {
  const e = String(entry ?? "").trim()
  if (!e) return null
  if (e.startsWith(".") || e.startsWith("/")) {
    const abs = e.startsWith("/") ? e : join(docDir, e)
    const meta = isPluginProject(abs)
    return {
      name: meta?.name ?? basename(abs),
      dir: abs,
      kind: "local",
      configOnly: true,
      description: meta?.description,
    }
  }
  const name =
    e.startsWith("http") || e.includes("://") ? stripVersion(basename(e).replace(/\.git$/, "")) : stripVersion(e)
  // A specifier that survives the branches above always yields a non-empty
  // name (empty input returns early; stripVersion never erases one).
  return { name, kind: "npm", configOnly: true }
}

// Load every plugin from two complementary sources:
//  1. the plugin registry (client.plugin.list()) — activation state and the
//     built-ins; the server only activates plugins with server features, so
//     TUI-only plugins are absent here
//  2. the config documents (client.config.get()) — every configured plugin,
//     local or npm, loaded or not
// and merge with the workspace scan for uninstalled candidates.
export async function loadEntries(ctx: any, root: string): Promise<Entry[]> {
  const [regOut, cfgOut] = await Promise.all([
    ctx.client.plugin.list().catch(() => undefined),
    ctx.client.config.get().catch(() => undefined),
  ])
  const registry = asArray<any>(regOut)

  const localDirs = new Set(
    registry.map((p) => (p.source?.type === "local" && p.source.path ? dirname(p.source.path) : "")).filter(Boolean),
  )
  const ids = new Set(registry.map((p) => String(p.id ?? "")).filter(Boolean))
  const targets = new Set(
    registry
      .map((p) => (p.source?.type === "package" && p.source.target ? stripVersion(String(p.source.target)) : ""))
      .filter(Boolean),
  )

  const entries: Entry[] = registry.map((p): Entry => {
    const src = p.source ?? {}
    const kind: Kind = src.type === "package" ? "npm" : src.type === "local" ? "local" : "builtin"
    const dir = kind === "local" ? dirname(src.path) : undefined
    const name =
      kind === "builtin"
        ? String(p.id ?? src.type)
        : basename(dir ?? stripVersion(String(src.target ?? p.id ?? "plugin")))
    return {
      name,
      kind,
      dir,
      version: kind === "npm" && src.version ? String(src.version) : undefined,
      outdated: src.outdated === true,
      status: String(p.state?.status ?? "") || undefined,
    }
  })

  // Config-declared plugins the registry doesn't know: local paths resolve
  // against each config document's directory; npm specifiers keep their
  // package name. Skip anything the registry already covers.
  //
  // The service may run from a different location than this workspace, so
  // config.get() can omit the project's opencode.json entirely — read the
  // project config files directly as well, and collect every declared
  // plugin (registry + config docs + project files) into coverage sets the
  // uninstalled scan checks against.
  const cfgData: any = (cfgOut as any)?.data ?? cfgOut
  const docs: any[] = Array.isArray(cfgData) ? cfgData : asArray<any>(cfgData)

  // Coverage: dirs/names of every plugin declared as installed anywhere.
  const coveredDirs = new Set(localDirs)
  const coveredNames = new Set<string>([...ids, ...targets])

  const pushConfigEntries = (plugins: string[], docDir: string) => {
    for (const raw of plugins) {
      const e = configEntry(raw, docDir)
      if (!e) continue
      if (e.dir) coveredDirs.add(e.dir)
      coveredNames.add(e.name)
      const known =
        (e.dir && localDirs.has(e.dir)) ||
        ids.has(e.name) ||
        targets.has(e.name) ||
        entries.some((x) => (e.dir ? x.dir === e.dir : false) || (x.kind === e.kind && x.name === e.name))
      if (known) continue
      entries.push(e)
    }
  }

  for (const doc of docs) {
    const plugins = (doc?.info as any)?.plugins
    if (!Array.isArray(plugins)) continue
    pushConfigEntries(plugins, doc?.path ? dirname(String(doc.path)) : root)
  }

  // The project's own config files, regardless of where the service runs.
  // Tolerant parse: jsonc (comments, trailing commas) is allowed here too.
  for (const file of ["opencode.json", "opencode.jsonc"]) {
    const path = join(root, file)
    try {
      const parsed = tolerantParse(readFileSync(path, "utf8")) as any
      if (parsed && Array.isArray(parsed.plugins)) {
        pushConfigEntries(parsed.plugins, root)
      }
    } catch {
      // No readable project config here.
    }
  }

  // Backfill descriptions for local entries the registry knows but the
  // config/scan didn't cover (one package.json read per project).
  for (const e of entries) {
    if (e.kind === "local" && e.dir && !e.description) {
      try {
        const pkg = JSON.parse(readFileSync(join(e.dir, "package.json"), "utf8"))
        if (pkg.description) e.description = String(pkg.description)
      } catch {
        // No readable package.json — leave the description empty.
      }
    }
  }

  // Uninstalled workspace candidates.
  const seen = new Set(entries.map((e) => e.dir ?? e.name))
  for (const cand of scanWorkspace(root)) {
    const key = cand.dir!
    if (coveredDirs.has(key) || coveredNames.has(cand.name)) {
      const existing = entries.find((e) => e.dir === key || e.name === cand.name)
      if (existing) {
        existing.dir = existing.dir ?? key
        existing.description = existing.description ?? cand.description
        // Config-declared but unregistered by the server: not uninstalled.
        if (existing.status === "uninstalled") {
          existing.status = undefined // registered: now just installed
        }
      }
      continue
    }
    // Any prior entry with this dir would have matched coveredDirs above, so
    // `seen.has(key)` is always false here; the guard is defensive only.
    /* v8 ignore start */
    if (!seen.has(key)) {
      seen.add(key)
      entries.push(cand)
    }
    /* v8 ignore stop */
  }

  return entries.toSorted((a, b) => {
    const ka = GROUP_ORDER.indexOf(a.kind)
    const kb = GROUP_ORDER.indexOf(b.kind)
    if (ka !== kb) return ka - kb
    return a.name.localeCompare(b.name)
  })
}

// ---------------------------------------------------------------------------
// Config toggle — install (register) or uninstall (remove) a plugin by
// editing the `plugins` array of the config file that declares it.
// ---------------------------------------------------------------------------

/** The config document that owns a `plugins` array, preferring the project's
 * own opencode.json; falls back to `<root>/opencode.json`. */
export function configDocPath(docs: any[], root: string): string {
  const withPlugins = docs.filter((d) => Array.isArray((d?.info as any)?.plugins) && d.path)
  const project = withPlugins.find((d) => dirname(String(d.path)) === root)
  if (project) return String(project.path)
  if (withPlugins.length > 0) return String(withPlugins[0].path)
  // No doc with plugins: edit the project's own config — jsonc if that is
  // what exists, else the default opencode.json.
  const jsonc = join(root, "opencode.jsonc")
  if (statSync(jsonc, { throwIfNoEntry: false })?.isFile()) return jsonc
  return join(root, "opencode.json")
}

/** Resolve a config plugin specifier to the entry it would match, if any. */
export function specMatches(spec: string, docDir: string, e: Entry): boolean {
  const s = String(spec ?? "").trim()
  if (!s) return false
  if (e.kind === "local" || e.dir) {
    if (s.startsWith(".") || s.startsWith("/")) {
      const abs = s.startsWith("/") ? s : join(docDir, s)
      return e.dir ? abs === e.dir : basename(abs) === e.name
    }
    return false
  }
  return stripVersion(s) === e.name
}

export function readConfig(path: string): {
  ok: boolean
  plugins: string[]
  rest: any
} {
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch {
    return { ok: false, plugins: [], rest: {} }
  }
  const parsed = tolerantParse(raw)
  if (parsed === undefined || typeof parsed !== "object" || parsed === null) {
    return { ok: false, plugins: [], rest: {} }
  }
  const obj = parsed as Record<string, unknown>
  return {
    ok: true,
    plugins: Array.isArray(obj.plugins) ? obj.plugins.map(String) : [],
    rest: obj,
  }
}

// ---------------------------------------------------------------------------
// Tolerant JSONC config handling
//
// OpenCode configs may be JSONC (comments, trailing commas), and users
// legitimately keep comments in them. Two pieces:
//   1. tolerantParse — reads JSONC the way the server does.
//   2. textual plugins-array editing — splices the `plugins` array in place
//      so every comment and every byte of formatting outside it survives.
// ---------------------------------------------------------------------------

/** Strip // and block comments plus trailing commas from JSONC text (string
 * contents are preserved verbatim) so JSON.parse can read the result. */
export function cleanJsonc(text: string): string {
  let out = ""
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '"') {
      // Copy the string (with escapes) verbatim.
      let j = i + 1
      while (j < text.length) {
        if (text[j] === "\\") j += 2
        else if (text[j] === '"') {
          j++
          break
        } else j++
      }
      out += text.slice(i, j)
      i = j
      continue
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++
      continue // the newline itself is copied on the next iteration
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++
      i += 2
      out += " "
      continue
    }
    if (c === ",") {
      // Drop a trailing comma: skip whitespace/comments after it and check
      // whether the next significant character closes the current scope.
      let j = i + 1
      for (;;) {
        while (j < text.length && /\s/.test(text[j])) j++
        if (text[j] === "/" && text[j + 1] === "/") {
          while (j < text.length && text[j] !== "\n") j++
          continue
        }
        if (text[j] === "/" && text[j + 1] === "*") {
          j += 2
          while (j < text.length && !(text[j] === "*" && text[j + 1] === "/")) j++
          j += 2
          continue
        }
        break
      }
      if (text[j] === "}" || text[j] === "]") {
        i++ // drop the comma
        continue
      }
    }
    out += c
    i++
  }
  return out
}

/** Parse JSONC (or plain JSON). Returns undefined for unparseable input. */
export function tolerantParse(text: string): unknown {
  try {
    return JSON.parse(cleanJsonc(text))
  } catch {
    return undefined
  }
}

interface StrTok {
  t: "str"
  v: string
  start: number
  end: number
}
interface PTok {
  t: "p"
  ch: string
  start: number
}
type Tok = StrTok | PTok

/** Tokenize JSONC: strings (with offsets) and punctuation; comments skipped. */
function scanTokens(text: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '"') {
      let j = i + 1
      while (j < text.length) {
        if (text[j] === "\\") j += 2
        else if (text[j] === '"') {
          j++
          break
        } else j++
      }
      toks.push({ t: "str", v: text.slice(i + 1, j - 1), start: i, end: j })
      i = j
      continue
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++
      continue
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++
      i += 2
      continue
    }
    if ("{}[],:".includes(c)) toks.push({ t: "p", ch: c, start: i })
    i++
  }
  return toks
}

function indentOf(text: string, pos: number): string {
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1
  // `[ \t]*` always matches (possibly empty), so exec never returns null.
  return /^[ \t]*/.exec(text.slice(lineStart, pos))![0]
}

/** Locate the top-level `plugins` key. Returns the token index of its "[",
 * or null when the key is absent. `nonArray` flags `"plugins": <not-array>`.
 * Only the root-level key matches — nested objects that happen to have a
 * `plugins` key (e.g. under `mcp`) are ignored. */
function findPluginsArray(toks: Tok[]): { bracket: number; nonArray?: boolean } | null {
  // The document is an object, so its keys live at brace depth 1; anything
  // nested sits deeper.
  let depth = 0
  for (let i = 0; i < toks.length - 1; i++) {
    const t = toks[i]
    if (t.t === "p") {
      if (t.ch === "{" || t.ch === "[") depth++
      else if (t.ch === "}" || t.ch === "]") depth--
      continue
    }
    if (depth !== 1 || t.t !== "str" || t.v !== "plugins") continue
    const colon = toks[i + 1]
    if (colon.t !== "p" || colon.ch !== ":") continue
    const value = toks[i + 2]
    if (value.t === "p" && value.ch === "[") return { bracket: i + 2 }
    return { bracket: -1, nonArray: true }
  }
  return null
}

/** Collect the string items of the plugins array. Returns null when the array
 * holds anything besides strings and commas (not a plugin list) — callers
 * fall back to a full rewrite. */
function arrayItems(toks: Tok[], open: number, close: number): StrTok[] | null {
  const items: StrTok[] = []
  for (let i = open + 1; i < close; i++) {
    const t = toks[i]
    if (t.t === "str") items.push(t)
    else if (t.ch !== ",") return null
  }
  return items
}

function matchingClose(toks: Tok[], open: number): number {
  let depth = 0
  for (let i = open; i < toks.length; i++) {
    const t = toks[i]
    if (t.t !== "p") continue
    if (t.ch === "[" || t.ch === "{") depth++
    else if (t.ch === "]" || t.ch === "}") {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Insert a plugin specifier into the `plugins` array textually. Returns the
 * updated document, the original text when the spec is already present, or
 * null when there is no plugins array (the caller may insert one). */
export function addPluginSpec(raw: string, spec: string): string | null {
  const toks = scanTokens(raw)
  const found = findPluginsArray(toks)
  if (!found || found.nonArray || found.bracket < 0) return null
  const close = matchingClose(toks, found.bracket)
  if (close < 0) return null
  const items = arrayItems(toks, found.bracket, close)
  if (items === null) return null
  const q = JSON.stringify(spec)

  if (items.length === 0) {
    const openTok = toks[found.bracket] as PTok
    const closeTok = toks[close] as PTok
    if (!raw.slice(openTok.start, closeTok.start).includes("\n")) {
      return raw.slice(0, openTok.start + 1) + q + raw.slice(closeTok.start)
    }
    const ind = indentOf(raw, closeTok.start)
    return raw.slice(0, openTok.start + 1) + `\n${ind}  ${q}\n${ind}` + raw.slice(closeTok.start)
  }

  if (items.some((t) => t.v === spec)) return raw
  const last = items[items.length - 1]
  // Inline array: append without a newline.
  if (!raw.slice(toks[found.bracket].start, last.start).includes("\n")) {
    return raw.slice(0, last.end) + `,${q}` + raw.slice(last.end)
  }
  const ind = indentOf(raw, last.start)
  // A trailing comma (legal JSONC) right after the last item → insert after it.
  let after = last.end
  while (after < raw.length && (raw[after] === " " || raw[after] === "\t")) after++
  if (raw[after] === ",") {
    return raw.slice(0, after + 1) + `\n${ind}${q}` + raw.slice(after + 1)
  }
  return raw.slice(0, last.end) + `,\n${ind}${q}` + raw.slice(last.end)
}

/** Insert a `plugins` array (with one specifier) into a document that has no
 * plugins key, textually — preserving any comments. */
export function addPluginsKey(raw: string, spec: string): string | null {
  const toks = scanTokens(raw)
  let closeTok: PTok | undefined
  for (const t of toks) if (t.t === "p" && t.ch === "}") closeTok = t
  if (!closeTok) return null
  const q = JSON.stringify(spec)
  // Does the object already have members (a "," or ":" before the brace)?
  let needsComma = false
  for (const t of toks) {
    if (t.t === "p" && t.ch === "}" && t.start === closeTok.start) break
    if (t.t === "p" && (t.ch === "," || t.ch === ":")) needsComma = true
  }
  const ind = indentOf(raw, closeTok.start)
  const prefix = needsComma ? "," : ""
  return raw.slice(0, closeTok.start) + `${prefix}\n${ind}  "plugins": [${q}]\n${ind}` + raw.slice(closeTok.start)
}

/** Remove the first plugin specifier matching `matches` from the `plugins`
 * array, textually. Returns the text and whether anything was removed, or
 * null when there is no plugins array. */
export function removePluginSpec(
  raw: string,
  matches: (spec: string) => boolean,
): { text: string; removed: boolean } | null {
  const toks = scanTokens(raw)
  const found = findPluginsArray(toks)
  if (!found || found.nonArray || found.bracket < 0) return null
  const close = matchingClose(toks, found.bracket)
  if (close < 0) return null
  const items = arrayItems(toks, found.bracket, close)
  if (items === null) return null

  // Find the first matching item's token index directly.
  let at = -1
  for (let i = found.bracket + 1; i < close; i++) {
    const t = toks[i]
    if (t.t === "str" && matches(t.v)) {
      at = i
      break
    }
  }
  if (at < 0) return { text: raw, removed: false }
  const item = toks[at] as StrTok
  // Trim whitespace back to (and including) the item's newline, so a removed
  // multiline item doesn't leave a blank indented line behind.
  let cutStart = item.start
  while (cutStart > 0 && (raw[cutStart - 1] === " " || raw[cutStart - 1] === "\t")) cutStart--
  if (raw[cutStart - 1] === "\n") cutStart--
  const next = toks[at + 1]
  if (next && next.t === "p" && next.ch === ",") {
    // Drop the item and its trailing comma, collapsing the whitespace after
    // the comma to a single space so inline arrays keep a separator. When the
    // removed item was the first, no separator is needed after the "[".
    let end = (next as PTok).start + 1
    let ws = ""
    const isFirst = !toks.slice(found.bracket + 1, at).some((t) => t.t === "str")
    if (!isFirst) {
      while (end < raw.length && (raw[end] === " " || raw[end] === "\t")) {
        ws ||= " "
        end++
      }
    }
    return {
      text: raw.slice(0, cutStart) + ws + raw.slice(end),
      removed: true,
    }
  }
  // Last item: drop the preceding comma (if any) together with the item.
  if (at > found.bracket + 1) {
    const prev = toks[at - 1]
    if (prev.t === "p" && prev.ch === ",") cutStart = prev.start
  }
  return { text: raw.slice(0, cutStart) + raw.slice(item.end), removed: true }
}

/** Apply an install/uninstall edit to the raw config text, preserving every
 * comment and every byte of formatting outside the `plugins` array. Falls
 * back to a full rewrite only when the document shape defeats the textual
 * edit. */
function editPluginsText(
  raw: string,
  edit: { add: string; remove?: undefined } | { add?: undefined; remove: (spec: string) => boolean },
  parsed: any,
  next: string[],
): string {
  if (edit.add !== undefined) {
    const spliced = addPluginSpec(raw, edit.add)
    if (spliced !== null) return spliced
    const keyed = addPluginsKey(raw, edit.add)
    if (keyed !== null) return keyed
  } else {
    const result = removePluginSpec(raw, edit.remove)
    if (result !== null) return result.text
  }
  const base = typeof parsed === "object" && parsed !== null ? parsed : {}
  return `${JSON.stringify({ ...base, plugins: next }, null, 2)}\n`
}

// Toggle a plugin's installed/uninstalled status by editing the config's
// `plugins` array. The edit is textual, so comments and formatting in JSONC
// configs survive. Returns a user-facing message; throws on failure.
export async function toggleInstalled(ctx: any, root: string, e: Entry): Promise<string> {
  const cfgOut = await ctx.client.config.get().catch((_err: any) => {
    return undefined
  })
  const cfgData: any = (cfgOut as any)?.data ?? cfgOut
  const docs = Array.isArray(cfgData) ? cfgData : asArray<any>(cfgData)
  const path = configDocPath(docs, root)
  const docDir = dirname(path)
  let raw = ""
  try {
    raw = readFileSync(path, "utf8")
  } catch {
    raw = ""
  }
  const parsed = tolerantParse(raw)
  if (parsed === undefined) throw new Error(`Cannot parse ${path}`)
  const plugins = Array.isArray((parsed as any)?.plugins) ? (parsed as any).plugins.map(String) : []
  const installing = e.status === "uninstalled"

  let next: string[]
  let edit: { add: string; remove?: undefined } | { add?: undefined; remove: (spec: string) => boolean }
  if (installing) {
    const spec = e.dir ? `./${basename(e.dir)}` : e.name // npm specifier; OpenCode resolves it on next start
    if (plugins.includes(spec)) {
      return `${e.name} registered — restart the TUI to load it`
    }
    next = [...plugins, spec]
    edit = { add: spec }
  } else {
    next = plugins.filter((spec: string) => !specMatches(spec, docDir, e))
    if (next.length === plugins.length) throw new Error(`No config entry matches ${e.name}`)
    edit = { remove: (spec) => specMatches(spec, docDir, e) }
  }

  const fs = await import("node:fs")
  fs.writeFileSync(path, editPluginsText(raw, edit, parsed, next))
  return installing
    ? `${e.name} registered — restart the TUI to load it`
    : `${e.name} removed — restart the TUI to unload it`
}

// ---------------------------------------------------------------------------
// Widget — the top-level section and each group render through the kit's
// CollapsibleSection/CollapsibleGroup (same pattern as the built-in
// opencode.sidebar.mcp widget and the skill lister).
// ---------------------------------------------------------------------------

export const STATUS_GLYPH: Record<string, string> = {
  active: "✓",
  inactive: "○",
  failed: "✗",
}

export const GROUP_TITLE: Record<Kind, string> = {
  npm: "NPM",
  local: "LOCAL",
  builtin: "BUILT-IN",
}

export function PluginList(props: { sessionID?: string }) {
  const ctx = usePlugin()
  const theme = ctx.theme

  // Built-in categories: sub-groups inside the BUILT-IN section, derived
  // from the plugin id (opencode.<category>.<name>); everything without a
  // known category lands in "core".
  const BUILTIN_CATEGORIES: Array<[string, string]> = [
    ["tool", "TOOLS"],
    ["provider", "PROVIDERS"],
    ["config", "CONFIG"],
    ["websearch", "WEB SEARCH"],
    ["prompt", "PROMPT ADAPTERS"],
  ]
  const builtinCategory = (id: string): string => {
    const parts = id.split(".")
    return parts[0] === "opencode" && parts.length >= 2 ? parts[1] : ""
  }
  const builtinSubGroups = (items: Entry[]) => {
    const groups: Array<{ key: string; title: string; items: Entry[] }> = []
    const seen = new Map<string, Entry[]>()
    for (const [cat, title] of BUILTIN_CATEGORIES) {
      const items2 = items.filter((e) => builtinCategory(e.name) === cat)
      if (items2.length) {
        seen.set(cat, items2)
        groups.push({ key: `builtin:${cat}`, title, items: items2 })
      }
    }
    const rest = items.filter((e) => !seen.has(builtinCategory(e.name)))
    if (rest.length) groups.push({ key: "builtin:core", title: "CORE", items: rest })
    return groups
  }

  // Built-ins are collapsed out of the summary count when hidden via
  // /plugins-builtins (view toggle only — they still run).
  const list = () => {
    const all = entries.data() ?? []
    return builtins.value() ? all : all.filter((e) => e.kind !== "builtin")
  }

  // Click-to-inspect (built-ins have no hover tooltip support in OpenTUI):
  // selecting a row reveals its details inline beneath it.
  const [selected, setSelected] = createSignal<string | null>(null)
  const selectRow = (e: Entry) => setSelected((cur) => (cur === e.name ? null : e.name))

  const entries = createCachedResource(
    () => props.sessionID,
    async () => loadEntries(ctx, workspaceDirectory(ctx)),
    { cache },
  )

  const groups = () =>
    GROUP_ORDER.map((kind) => ({
      kind,
      items: list().filter((e) => e.kind === kind),
    })).filter((g) => g.items.length > 0)

  // Collapsed summary, omitting empty groups: "2 npm · 4 local · 86 builtin".
  const summary = () =>
    GROUP_ORDER.map((kind) => {
      const n = list().filter((e) => e.kind === kind).length
      return n > 0 ? `${n} ${kind}` : ""
    })
      .filter(Boolean)
      .join(" · ")

  // Click a plugin row to flip its status: uninstalled → registered in the
  // project config; installed → removed from it. A restart applies the
  // change (plugins load at startup).
  const [note, setNote] = createSignal<{ ok: boolean; text: string } | null>(null)
  const onToggle = async (e: Entry) => {
    // Built-in rows render no [–]/[+] control and route row clicks to
    // selectRow() instead, so built-ins never reach this handler.
    const root = workspaceDirectory(ctx)
    try {
      const message = await toggleInstalled(ctx, root, e)
      setNote({ ok: true, text: message })
      showToast(ctx, message)
      await entries.refetchNow()
    } catch (err: any) {
      // toggleInstalled only ever throws Errors; use the message directly.
      const text = err.message as string
      setNote({ ok: false, text })
      showToast(ctx, text, "error")
    }
  }

  const row = (e: Entry) => {
    const uninstalled = e.status === "uninstalled"
    const fg = uninstalled ? theme.text.subdued : theme.text.default
    const glyph = uninstalled ? "○" : (STATUS_GLYPH[e.status ?? ""] ?? "•")
    const version = e.version ? ` ${e.version}` : ""
    const flag = e.outdated ? " ⚠ update" : ""
    // MCPs show "connected"; plugins show their install state, right-aligned.
    const state = uninstalled ? "uninstalled" : e.status === "failed" ? "failed" : "installed"
    return {
      glyph,
      text: `${e.name}${version}${flag}`,
      state,
      fg,
      stateFg: state === "failed" ? theme.text.default : theme.text.subdued,
      // Explicit per-row control: [–] removes the config entry, [+] registers
      // it. Built-ins aren't config-managed, so no control.
      control: e.kind === "builtin" ? "" : uninstalled ? "[+]" : "[–]",
    }
  }

  // One plugin row + its optional inline description (built-ins only).
  const RowBlock = (p: { e: Entry }) => {
    const r = row(p.e)
    const e = p.e
    return (
      <box flexDirection="column">
        <box flexDirection="row" gap={1} minWidth={0} onMouseDown={() => selectRow(e)}>
          <text fg={r.fg} flexShrink={0}>
            {r.glyph}
          </text>
          <text fg={r.fg} wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
            {r.text}
          </text>
          <text fg={r.stateFg} flexShrink={0}>
            {r.state}
          </text>
          <Show when={r.control}>
            <text fg={theme.text.subdued} flexShrink={0} onMouseDown={() => onToggle(e)}>
              {r.control}
            </text>
          </Show>
        </box>
        <Show when={selected() === e.name}>
          <box flexDirection="column" marginLeft={3} onMouseDown={() => selectRow(e)}>
            <text fg={theme.text.subdued} wrapMode="none">
              {e.kind === "builtin"
                ? describeBuiltin(e.name)
                : (e.description ?? "No description — check the project's package.json.")}
            </text>
          </box>
        </Show>
      </box>
    )
  }

  return (
    <Show when={!entries.data.error} fallback={<text>⚠ plugins unavailable</text>}>
      <Show when={list().length > 0}>
        <CollapsibleSection
          title="PLUGINS"
          count={list().length}
          summary={summary()}
          pinned={
            <Show when={note()}>
              {(n) => (
                <text fg={n().ok ? theme.text.subdued : theme.text.default} wrapMode="none" truncate>
                  {n().ok ? "" : "✗ "}
                  {n().text}
                </text>
              )}
            </Show>
          }
        >
          <For each={groups()}>
            {(g) => (
              <CollapsibleGroup
                title={GROUP_TITLE[g.kind]}
                count={g.items.length}
                defaultCollapsed={DEFAULT_COLLAPSED[g.kind]}
              >
                {(collapsed) => (
                  <>
                    <Show when={g.kind === "builtin" && !collapsed()}>
                      <text fg={theme.text.subdued} wrapMode="none" truncate>
                        built-ins can't be disabled individually;{" "}
                        {process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS
                          ? "OPENCODE_DISABLE_DEFAULT_PLUGINS is on (all off)"
                          : "OPENCODE_DISABLE_DEFAULT_PLUGINS turns all off"}
                      </text>
                    </Show>
                    <Show when={g.kind === "builtin"} fallback={<For each={g.items}>{(e) => <RowBlock e={e} />}</For>}>
                      <For each={builtinSubGroups(g.items)}>
                        {(sub) => (
                          <CollapsibleGroup title={sub.title} count={sub.items.length}>
                            <For each={sub.items}>{(e) => <RowBlock e={e} />}</For>
                          </CollapsibleGroup>
                        )}
                      </For>
                    </Show>
                  </>
                )}
              </CollapsibleGroup>
            )}
          </For>
        </CollapsibleSection>
      </Show>
    </Show>
  )
}

// The cache must exist before the component renders, so create it at module
// scope and hydrate it from setup() (which owns the storage context).
type EntryCache = ReturnType<typeof createCachedStore<Entry[] | null>>
let cache: EntryCache

// Built-ins visibility: shown by default; /plugins-builtins toggles the
// view (kit createToggle). This is a view toggle only — built-ins always
// run. Created in setup() because it needs the storage context, then read
// from the component via module scope (same pattern as `cache` above).
let builtins: Toggle

export default Plugin.define({
  id: "plugin-manager.cli",
  setup(context: any) {
    // Claim the sidebar slot FIRST, before any view-state init: a failed or
    // delayed claim renders nothing. Anchor above the footer —
    // `after: "sidebar.content"` lands in a region the slot tree never shows.
    let cleanupView: (() => void) | undefined
    try {
      cleanupView = context.ui.slot({
        before: "sidebar.footer",
        render: ({ sessionID }: { sessionID?: string }) => <PluginList sessionID={sessionID} />,
      })
    } catch (error) {
      console.warn("[plugin-manager] failed to claim sidebar slot", error)
    }

    cache = createCachedStore<Entry[] | null>(context, "plugin-manager", {
      initial: null,
      staleAfterMs: 60_000,
    })

    // The kit's createToggle persists { value } under "builtins"; the legacy
    // { show } shape it can't read falls back to the visible-by-default
    // initial — the same outcome the previous one-time reset enforced.
    builtins = createToggle(context, {
      storageKey: "builtins",
      initial: true,
      command: {
        id: "plugins.builtins",
        group: "Plugins",
        name: "plugins-builtins",
        description: "Show or hide the built-in plugins group in the sidebar",
        title: (value) => `Plugins: built-ins (${value ? "visible" : "hidden"})`,
      },
      toast: (value) => `Built-in plugins ${value ? "visible" : "hidden"} (they still run)`,
    })
    builtins.registerCommand()

    return () => {
      cleanupView?.()
    }
  },
})
