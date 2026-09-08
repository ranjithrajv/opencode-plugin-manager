import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
  configDocPath,
  configEntry,
  DEFAULT_COLLAPSED,
  GROUP_ORDER,
  GROUP_TITLE,
  isPluginProject,
  loadEntries,
  readConfig,
  scanWorkspace,
  specMatches,
  STATUS_GLYPH,
  stripVersion,
  toggleInstalled,
} from "../tui.tsx"

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "opm-"))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function writePkg(dir: string, pkg: unknown) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg))
}

describe("constants", () => {
  test("group order and defaults", () => {
    expect(GROUP_ORDER).toEqual(["npm", "local", "builtin"])
    expect(DEFAULT_COLLAPSED).toEqual({ builtin: true })
    expect(STATUS_GLYPH).toEqual({ active: "✓", inactive: "○", failed: "✗" })
    expect(GROUP_TITLE.npm).toBe("NPM")
    expect(GROUP_TITLE.builtin).toBe("BUILT-IN")
  })
})

describe("isPluginProject", () => {
  test("returns the package name when @opencode-ai/plugin is a dependency", () => {
    writePkg(join(root, "a"), {
      name: "my-plugin",
      description: "does things",
      dependencies: { "@opencode-ai/plugin": "*" },
    })
    expect(isPluginProject(join(root, "a"))).toEqual({ name: "my-plugin", description: "does things" })
  })

  test("also accepts peerDependencies and omits empty descriptions", () => {
    writePkg(join(root, "b"), { name: "peer-plugin", peerDependencies: { "@opencode-ai/plugin": "*" } })
    expect(isPluginProject(join(root, "b"))).toEqual({ name: "peer-plugin", description: undefined })
  })

  test("private packages are not plugin projects", () => {
    writePkg(join(root, "c"), { name: "root", private: true, dependencies: { "@opencode-ai/plugin": "*" } })
    expect(isPluginProject(join(root, "c"))).toBeNull()
  })

  test("no plugin dependency → null", () => {
    writePkg(join(root, "d"), { name: "plain" })
    expect(isPluginProject(join(root, "d"))).toBeNull()
  })

  test("falls back to the directory basename when name is missing", () => {
    writePkg(join(root, "e"), { dependencies: { "@opencode-ai/plugin": "*" } })
    expect(isPluginProject(join(root, "e"))).toEqual({ name: "e", description: undefined })
  })

  test("missing package.json → null", () => {
    expect(isPluginProject(join(root, "nope"))).toBeNull()
  })

  test("invalid JSON → null", () => {
    mkdirSync(join(root, "bad"))
    writeFileSync(join(root, "bad", "package.json"), "{nope")
    expect(isPluginProject(join(root, "bad"))).toBeNull()
  })
})

describe("scanWorkspace", () => {
  test("collects plugin projects, skipping dot-dirs, node_modules and non-plugins", () => {
    writePkg(join(root, "plug"), {
      name: "plug",
      description: "a plugin",
      dependencies: { "@opencode-ai/plugin": "*" },
    })
    writePkg(join(root, ".hidden"), { name: "h", dependencies: { "@opencode-ai/plugin": "*" } })
    writePkg(join(root, "node_modules", "dep"), { name: "dep", dependencies: { "@opencode-ai/plugin": "*" } })
    writePkg(join(root, "plain"), { name: "plain" })
    mkdirSync(join(root, "nopkg"))
    // package.json that is a directory, not a file
    mkdirSync(join(root, "dirpkg", "package.json"), { recursive: true })

    expect(scanWorkspace(root)).toEqual([
      {
        name: "plug",
        dir: join(root, "plug"),
        kind: "local",
        status: "uninstalled",
        description: "a plugin",
      },
    ])
  })

  test("readdir failure yields []", () => {
    expect(scanWorkspace(join(root, "missing"))).toEqual([])
  })
})

describe("stripVersion", () => {
  test("cases", () => {
    expect(stripVersion("pkg@1.2")).toBe("pkg")
    expect(stripVersion("@scope/pkg@1.2")).toBe("@scope/pkg")
    expect(stripVersion("@scope/pkg")).toBe("@scope/pkg")
    expect(stripVersion("pkg")).toBe("pkg")
    expect(stripVersion("a@b@c")).toBe("a@b")
    expect(stripVersion("@1.2")).toBe("@1.2")
  })
})

describe("configEntry", () => {
  test("empty and blank entries are null", () => {
    expect(configEntry("", root)).toBeNull()
    expect(configEntry("   ", root)).toBeNull()
    expect(configEntry(undefined as unknown as string, root)).toBeNull()
  })

  test("relative paths resolve against docDir", () => {
    expect(configEntry("./my-plugin", root)).toEqual({
      name: "my-plugin",
      dir: join(root, "my-plugin"),
      kind: "local",
      configOnly: true,
      description: undefined,
    })
  })

  test("a real plugin project's metadata is used for local paths", () => {
    writePkg(join(root, "real"), {
      name: "real-plugin",
      description: "real",
      dependencies: { "@opencode-ai/plugin": "*" },
    })
    expect(configEntry("./real", root)).toEqual({
      name: "real-plugin",
      dir: join(root, "real"),
      kind: "local",
      configOnly: true,
      description: "real",
    })
  })

  test("absolute paths are kept", () => {
    expect(configEntry("/abs/plug", root)).toEqual({
      name: "plug",
      dir: "/abs/plug",
      kind: "local",
      configOnly: true,
      description: undefined,
    })
  })

  test("npm specifiers", () => {
    expect(configEntry("pkg", root)).toEqual({ name: "pkg", kind: "npm", configOnly: true })
    expect(configEntry("pkg@1.2", root)).toEqual({ name: "pkg", kind: "npm", configOnly: true })
  })

  test("git URLs reduce to the repo basename", () => {
    expect(configEntry("https://github.com/u/repo.git", root)).toEqual({
      name: "repo",
      kind: "npm",
      configOnly: true,
    })
    expect(configEntry("git+ssh://git@github.com/u/repo2.git", root)).toEqual({
      name: "repo2",
      kind: "npm",
      configOnly: true,
    })
    // a trailing fragment survives — only a literal ".git" suffix is stripped
    expect(configEntry("git+ssh://git@github.com/u/repo3.git#abc", root)).toEqual({
      name: "repo3.git#abc",
      kind: "npm",
      configOnly: true,
    })
    expect(configEntry("https://github.com/u/repo", root)).toEqual({
      name: "repo",
      kind: "npm",
      configOnly: true,
    })
  })
})

describe("configDocPath", () => {
  test("prefers the project's own config", () => {
    const docs = [
      { path: "/elsewhere/opencode.json", info: { plugins: [] } },
      { path: join(root, "opencode.json"), info: { plugins: ["pkg"] } },
    ]
    expect(configDocPath(docs, root)).toBe(join(root, "opencode.json"))
  })

  test("falls back to the first doc with plugins", () => {
    const docs = [{ path: "/other/opencode.json", info: { plugins: ["pkg"] } }]
    expect(configDocPath(docs, root)).toBe("/other/opencode.json")
  })

  test("defaults to <root>/opencode.json", () => {
    expect(configDocPath([], root)).toBe(join(root, "opencode.json"))
    expect(configDocPath([{ path: "/x/opencode.json" }], root)).toBe(join(root, "opencode.json"))
  })
})

describe("specMatches", () => {
  const local = (): Parameters<typeof specMatches>[2] => ({
    name: "my-plugin",
    kind: "local",
    dir: join(root, "my-plugin"),
  })
  const named: Parameters<typeof specMatches>[2] = { name: "pkg", kind: "npm" }

  test("blank spec never matches", () => {
    expect(specMatches("  ", root, named)).toBe(false)
    expect(specMatches(undefined as unknown as string, root, named)).toBe(false)
  })

  test("local entries match resolved paths", () => {
    expect(specMatches("./my-plugin", root, local())).toBe(true)
    expect(specMatches("/other/my-plugin", root, local())).toBe(false)
  })

  test("dir-less local entries match by basename", () => {
    const noDir: Parameters<typeof specMatches>[2] = { name: "my-plugin", kind: "local" }
    expect(specMatches("./my-plugin", root, noDir)).toBe(true)
    expect(specMatches("./other", root, noDir)).toBe(false)
  })

  test("local entries never match npm specifiers", () => {
    expect(specMatches("my-plugin", root, local())).toBe(false)
  })

  test("npm entries match by stripped name", () => {
    expect(specMatches("pkg@2.0", root, named)).toBe(true)
    expect(specMatches("other", root, named)).toBe(false)
    expect(specMatches("./pkg", root, { name: "pkg", kind: "npm", dir: join(root, "pkg") })).toBe(true)
  })
})

describe("readConfig", () => {
  test("parses plugins arrays", () => {
    const path = join(root, "opencode.json")
    writeFileSync(path, JSON.stringify({ plugins: ["a"], theme: "dark" }))
    expect(readConfig(path)).toEqual({ ok: true, plugins: ["a"], rest: { plugins: ["a"], theme: "dark" } })
  })

  test("non-array plugins → empty list", () => {
    const path = join(root, "opencode.json")
    writeFileSync(path, JSON.stringify({ plugins: "nope" }))
    const out = readConfig(path)
    expect(out.ok).toBe(true)
    expect(out.plugins).toEqual([])
  })

  test("missing/unparseable file", () => {
    expect(readConfig(join(root, "missing.json"))).toEqual({ ok: false, plugins: [], rest: {} })
  })

  test("a config whose root is a scalar or null is rejected", () => {
    writeFileSync(join(root, "scalar.json"), "42")
    expect(readConfig(join(root, "scalar.json"))).toEqual({ ok: false, plugins: [], rest: {} })
    writeFileSync(join(root, "null.json"), "null")
    expect(readConfig(join(root, "null.json"))).toEqual({ ok: false, plugins: [], rest: {} })
  })
})

describe("loadEntries", () => {
  function ctx(opts: {
    registry?: unknown[]
    config?: unknown
    failList?: boolean
    rejectList?: boolean
    rejectConfig?: boolean
  }) {
    return {
      client: {
        plugin: {
          list: vi.fn(() => {
            if (opts.failList) {
              return (() => {
                throw new Error("boom")
              })()
            }
            if (opts.rejectList) return Promise.reject(new Error("list down"))
            return Promise.resolve(opts.registry ?? [])
          }),
        },
        config: {
          get: vi.fn(() =>
            opts.rejectConfig ? Promise.reject(new Error("config down")) : Promise.resolve(opts.config),
          ),
        },
      },
    } as never
  }

  test("maps registry entries of every kind", async () => {
    const registry = [
      { id: "builtin.one", state: { status: "active" } },
      {
        id: "npm-plug",
        source: { type: "package", target: "npm-plug@1.0", version: "1.0", outdated: true },
        state: { status: "failed" },
      },
      { id: "loc", source: { type: "local", path: join(root, "loc", "index.ts") }, state: {} },
      { id: "weird", source: { type: "mystery" }, state: { status: "inactive" } },
    ]
    const entries = await loadEntries(ctx({ registry }), root)
    expect(entries.map((e) => [e.kind, e.name, e.status])).toEqual([
      ["npm", "npm-plug", "failed"],
      ["local", "loc", undefined],
      ["builtin", "builtin.one", "active"],
      ["builtin", "weird", "inactive"],
    ])
    const npm = entries[0]
    expect(npm.version).toBe("1.0")
    expect(npm.outdated).toBe(true)
    expect(entries[1].dir).toBe(join(root, "loc"))
  })

  test("covers id/target-less registry entries and their name fallbacks", async () => {
    const registry = [
      { source: { type: "mystery" } },
      { source: { type: "package" } },
      { id: "pid", source: { type: "package" } },
    ]
    const entries = await loadEntries(ctx({ registry }), root)
    expect(entries.map((e) => e.name)).toEqual(["pid", "plugin", "mystery"])
  })

  test("rejected client promises degrade to an empty load", async () => {
    const entries = await loadEntries(ctx({ rejectList: true, rejectConfig: true }), root)
    expect(entries).toEqual([])
  })

  test("adds config-only entries not covered by the registry", async () => {
    writePkg(join(root, "disc"), {
      name: "disc",
      description: "a local plugin",
      dependencies: { "@opencode-ai/plugin": "*" },
    })
    const registry = [{ id: "known", source: { type: "package", target: "known@1.0" } }]
    const config = {
      data: [
        { path: join(root, "opencode.json"), info: { plugins: ["known", "extra@2", "./disc", ""] } },
        { path: "/elsewhere/opencode.json", info: { plugins: ["from-doc-dir"] } },
        { path: "/noplug/opencode.json" },
        { path: "/bad/opencode.json", info: { plugins: "not-array" } },
      ],
    }
    const entries = await loadEntries(ctx({ registry, config }), root)
    const names = entries.map((e) => e.name)
    expect(names).toContain("extra")
    expect(names).toContain("disc")
    expect(names).toContain("from-doc-dir")
    expect(entries.filter((e) => e.name === "known")).toHaveLength(1)
    expect(entries.find((e) => e.name === "disc")).toMatchObject({
      kind: "local",
      configOnly: true,
      description: "a local plugin",
    })
    // blank entries skipped entirely
    expect(names).not.toContain("")
  })

  test("reads the project's opencode.json and .jsonc directly", async () => {
    writeFileSync(join(root, "opencode.json"), JSON.stringify({ plugins: ["file-plugin"] }))
    writeFileSync(join(root, "opencode.jsonc"), JSON.stringify({ plugins: ["jsonc-plugin"] }))
    // jsonc with comments isn't valid JSON → ignored
    writeFileSync(join(root, "broken.jsonc"), '{\n// comment\n"plugins": ["nope"]\n}')
    const entries = await loadEntries(ctx({}), root)
    const names = entries.map((e) => e.name)
    expect(names).toContain("file-plugin")
    expect(names).toContain("jsonc-plugin")
    expect(names).not.toContain("nope")
    for (const e of entries) expect(e.configOnly).toBe(true)
  })

  test("backfills descriptions for local entries missing one", async () => {
    writePkg(join(root, "desc"), {
      name: "desc",
      description: "backfilled",
      dependencies: { "@opencode-ai/plugin": "*" },
    })
    writePkg(join(root, "nodesc"), { name: "nodesc", dependencies: { "@opencode-ai/plugin": "*" } })
    const registry = [
      { id: "d1", source: { type: "local", path: join(root, "desc", "index.ts") } },
      { id: "d2", source: { type: "local", path: join(root, "nodesc", "index.ts") } },
      { id: "d3", source: { type: "local", path: join(root, "gone", "index.ts") } },
    ]
    const entries = await loadEntries(ctx({ registry }), root)
    const byName = new Map(entries.map((e) => [e.name, e]))
    expect(byName.get("desc")?.description).toBe("backfilled")
    expect(byName.get("nodesc")?.description).toBeUndefined()
    expect(byName.get("gone")?.description).toBeUndefined()
  })

  test("uninstalled workspace candidates that aren't declared anywhere", async () => {
    writePkg(join(root, "orphan"), { name: "orphan", dependencies: { "@opencode-ai/plugin": "*" } })
    const entries = await loadEntries(ctx({}), root)
    expect(entries).toEqual([
      {
        name: "orphan",
        dir: join(root, "orphan"),
        kind: "local",
        status: "uninstalled",
        description: undefined,
      },
    ])
  })

  test("covered workspace candidates are not duplicated", async () => {
    writePkg(join(root, "declared"), { name: "declared", dependencies: { "@opencode-ai/plugin": "*" } })
    writeFileSync(join(root, "opencode.json"), JSON.stringify({ plugins: ["./declared"] }))
    const registry = [{ id: "declared", source: { type: "local", path: join(root, "declared", "index.ts") } }]
    const entries = await loadEntries(ctx({ registry }), root)
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe("local")
    expect(entries[0].configOnly).toBeUndefined()
  })

  test("a scan hit clears a registry entry's uninstalled status", async () => {
    // The registry knows the plugin but reports it uninstalled (e.g. the
    // service hasn't reloaded since it was added to the config). The
    // workspace scan finds the dir, so the stale status is cleared.
    writePkg(join(root, "fresh"), { name: "fresh", dependencies: { "@opencode-ai/plugin": "*" } })
    const registry = [
      {
        id: "fresh",
        source: { type: "local", path: join(root, "fresh", "index.ts") },
        state: { status: "uninstalled" },
      },
    ]
    const entries = await loadEntries(ctx({ registry }), root)
    expect(entries).toHaveLength(1)
    expect(entries[0].status).toBeUndefined()
  })

  test("a registry-reported uninstalled local plugin is marked installed again", async () => {
    // The server registry lists the plugin but its state says "uninstalled";
    // the workspace scan confirms it exists → it is registered, not uninstalled.
    writePkg(join(root, "loc"), { name: "loc", dependencies: { "@opencode-ai/plugin": "*" } })
    const registry = [
      {
        id: "loc",
        source: { type: "local", path: join(root, "loc", "index.ts") },
        state: { status: "uninstalled" },
      },
    ]
    const entries = await loadEntries(ctx({ registry }), root)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ name: "loc", kind: "local" })
    expect(entries[0].status).toBeUndefined()
  })

  test("a covered scan candidate without a matching entry is skipped", async () => {
    // Registry id "other" (entry name is the target, "whatever") covers the
    // workspace dir "other" by name; no entry carries that name/dir, so the
    // candidate is skipped without crashing.
    writePkg(join(root, "other"), { name: "other", dependencies: { "@opencode-ai/plugin": "*" } })
    const registry = [{ id: "other", source: { type: "package", target: "whatever@1.0" } }]
    const entries = await loadEntries(ctx({ registry }), root)
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe("whatever")
  })

  test("the load can reject with non-Error values", async () => {
    const ctx = {
      client: {
        plugin: {
          list: () => {
            throw "plain string failure"
          },
        },
        config: { get: () => Promise.resolve(undefined) },
      },
    } as never
    await expect(loadEntries(ctx, root)).rejects.toBe("plain string failure")
  })

  test("a synchronous registry failure degrades the whole load to an error", async () => {
    await expect(loadEntries(ctx({ failList: true }), root)).rejects.toThrow("boom")
  })

  test("config docs may be a bare array and may lack a path", async () => {
    writePkg(join(root, "nop"), { name: "nop", dependencies: { "@opencode-ai/plugin": "*" } })
    writeFileSync(join(root, "opencode.json"), JSON.stringify({ plugins: ["./nop"] }))
    const config = [{ info: { plugins: ["nop"] } }, { path: join(root, "elsewhere.json"), info: { plugins: ["bare"] } }]
    const entries = await loadEntries(ctx({ config }), root)
    const names = entries.map((e) => e.name)
    expect(names).toContain("bare")
    // "./nop" declared both by the pathless doc (against root) and the
    // project file → both a config-only npm and a local entry exist
    expect(entries.some((e) => e.kind === "local" && e.name === "nop")).toBe(true)
  })
})

describe("toggleInstalled", () => {
  function ctx(config?: unknown, configError?: boolean) {
    return {
      client: {
        config: {
          get: vi.fn(() => (configError ? Promise.reject(new Error("cfg")) : Promise.resolve(config))),
        },
      },
    } as never
  }

  test("installs a local plugin by appending ./name to the project config", async () => {
    const path = join(root, "opencode.json")
    writeFileSync(path, JSON.stringify({ plugins: ["pkg"], theme: "dark" }, null, 2))
    const message = await toggleInstalled(ctx(), root, {
      name: "my-plugin",
      kind: "local",
      status: "uninstalled",
      dir: join(root, "my-plugin"),
    })
    expect(message).toContain("registered")
    const written = JSON.parse(readFileSync(path, "utf8"))
    expect(written.plugins).toEqual(["pkg", "./my-plugin"])
    expect(written.theme).toBe("dark")
  })

  test("installing an npm plugin appends the bare name, idempotently", async () => {
    const path = join(root, "opencode.json")
    writeFileSync(path, JSON.stringify({ plugins: ["already"] }))
    const message = await toggleInstalled(ctx(), root, {
      name: "already",
      kind: "npm",
      status: "uninstalled",
    })
    expect(message).toContain("registered")
    expect(JSON.parse(readFileSync(path, "utf8")).plugins).toEqual(["already"])
  })

  test("uninstall removes the matching spec", async () => {
    const path = join(root, "opencode.json")
    writeFileSync(path, JSON.stringify({ plugins: ["pkg@1.0", "./gone"] }))
    const message = await toggleInstalled(ctx(), root, { name: "pkg", kind: "npm" })
    expect(message).toContain("removed")
    expect(JSON.parse(readFileSync(path, "utf8")).plugins).toEqual(["./gone"])
  })

  test("uninstall with no matching entry throws", async () => {
    const path = join(root, "opencode.json")
    writeFileSync(path, JSON.stringify({ plugins: [] }))
    await expect(toggleInstalled(ctx(), root, { name: "nope", kind: "npm" })).rejects.toThrow(
      "No config entry matches nope",
    )
  })

  test("throws when the config file cannot be parsed", async () => {
    writeFileSync(join(root, "opencode.json"), "{oops")
    await expect(toggleInstalled(ctx(), root, { name: "x", kind: "npm" })).rejects.toThrow("Cannot parse")
  })

  test("config.get failure falls back to the project file and still writes", async () => {
    const path = join(root, "opencode.json")
    writeFileSync(path, JSON.stringify({ plugins: ["pkg"] }))
    const message = await toggleInstalled(ctx(undefined, true), root, { name: "pkg", kind: "npm" })
    expect(message).toContain("removed")
    expect(JSON.parse(readFileSync(path, "utf8")).plugins).toEqual([])
  })

  test("the config doc in the project dir wins over docs elsewhere", async () => {
    const path = join(root, "opencode.json")
    writeFileSync(path, JSON.stringify({ plugins: ["a"] }))
    const config = {
      data: [
        { path: "/elsewhere/opencode.json", info: { plugins: ["a"] } },
        { path: join(root, "opencode.json"), info: { plugins: ["a"] } },
      ],
    }
    await toggleInstalled(ctx(config), root, { name: "new", kind: "npm", status: "uninstalled" })
    expect(JSON.parse(readFileSync(path, "utf8")).plugins).toEqual(["a", "new"])
    // without a project-dir doc, the first doc is used instead
    const config2 = { data: [{ path: "/elsewhere/opencode.json", info: { plugins: ["a"] } }] }
    await expect(toggleInstalled(ctx(config2), root, { name: "x", kind: "npm" })).rejects.toThrow(
      "Cannot parse /elsewhere/opencode.json",
    )
  })
})
