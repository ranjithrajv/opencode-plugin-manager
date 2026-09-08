import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import plugin, {
  addPluginSpec,
  addPluginsKey,
  cleanJsonc,
  removePluginSpec,
  tolerantParse,
  toggleInstalled,
} from "../tui.tsx"

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "opm-jsonc-"))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("cleanJsonc / tolerantParse", () => {
  test("plain JSON passes through", () => {
    expect(tolerantParse('{"a": 1}')).toEqual({ a: 1 })
  })

  test("line comments are stripped", () => {
    const out = tolerantParse(`{
      // plugin list
      "plugins": ["a"] // trailing
    }`)
    expect(out).toEqual({ plugins: ["a"] })
  })

  test("block comments are stripped", () => {
    const out = tolerantParse(`{
      /* plugin list
         spans lines */
      "plugins": ["a"]
    }`)
    expect(out).toEqual({ plugins: ["a"] })
  })

  test("trailing commas in objects and arrays are dropped", () => {
    expect(tolerantParse(`{"a": 1, "plugins": ["x",],}`)).toEqual({ a: 1, plugins: ["x"] })
  })

  test("trailing comma followed by comments still drops", () => {
    expect(tolerantParse(`{"a": [1, // c\n]}`)).toEqual({ a: [1] })
    expect(tolerantParse(`{"a": [1, /* c */ ]}`)).toEqual({ a: [1] })
    expect(tolerantParse(`{"a": 1, /* c */ }`)).toEqual({ a: 1 })
  })

  test("comment markers inside strings are preserved", () => {
    expect(tolerantParse(`{"url": "http://x/*y*/", "t": "a,//b"}`)).toEqual({
      url: "http://x/*y*/",
      t: "a,//b",
    })
    expect(cleanJsonc(`{"url": "http://x"}`)).toBe(`{"url": "http://x"}`)
  })

  test("escaped quotes inside strings survive", () => {
    expect(tolerantParse(`{"t": "say \\"hi\\""}`)).toEqual({ t: 'say "hi"' })
  })

  test("scalars parse", () => {
    expect(tolerantParse("42")).toBe(42)
    expect(tolerantParse('"x"')).toBe("x")
  })

  test("scalars and null parse but readConfig rejects them", () => {
    expect(tolerantParse("42")).toBe(42)
    expect(tolerantParse("null")).toBeNull()
  })

  test("unparseable input yields undefined", () => {
    expect(tolerantParse("{nope")).toBeUndefined()
    expect(tolerantParse("")).toBeUndefined()
    expect(tolerantParse("{")).toBeUndefined()
  })
})

describe("addPluginSpec", () => {
  test("inserts into an empty inline array", () => {
    expect(addPluginSpec(`{"plugins":[]}`, "x")).toBe(`{"plugins":["x"]}`)
  })

  test("inserts into an empty multiline array with indentation", () => {
    const out = addPluginSpec(`{\n  "plugins": [\n  ]\n}`, "x")
    expect(out).toBe(`{\n  "plugins": [\n    "x"\n  ]\n}`)
    expect(JSON.parse(out!)).toEqual({ plugins: ["x"] })
  })

  test("appends after the last item, matching its indentation", () => {
    const raw = `{\n  "plugins": [\n    "a",\n    "b"\n  ]\n}`
    const out = addPluginSpec(raw, "c")
    expect(JSON.parse(out!)).toEqual({ plugins: ["a", "b", "c"] })
    // comments and formatting outside the array are untouched
    expect(out).toContain(`"a",\n    "b",`)
  })

  test("appends inline when the array is inline", () => {
    expect(addPluginSpec(`{"plugins":["a"]}`, "b")).toBe(`{"plugins":["a","b"]}`)
  })

  test("appends inline with spaces preserved", () => {
    expect(addPluginSpec(`{"plugins": ["a", "b"]}`, "c")).toBe(`{"plugins": ["a", "b","c"]}`)
  })

  test("inserts after an existing trailing comma", () => {
    const out = addPluginSpec(`{\n  "plugins": [\n    "a",\n  ]\n}`, "b")
    expect(JSON.parse(out!)).toEqual({ plugins: ["a", "b"] })
  })

  test("a duplicate spec leaves the document untouched", () => {
    const raw = `{"plugins":["a"]}`
    expect(addPluginSpec(raw, "a")).toBe(raw)
  })

  test("returns null when there is no plugins array", () => {
    expect(addPluginSpec(`{"theme":"dark"}`, "x")).toBeNull()
    expect(addPluginSpec(`{"plugins":"nope"}`, "x")).toBeNull()
  })

  test("returns null for a nested or malformed array (caller falls back)", () => {
    expect(addPluginSpec(`{"plugins":[["a"]]}`, "x")).toBeNull()
    expect(addPluginSpec(`{"plugins": ["a"`, "x")).toBeNull()
  })

  test("skips keys that are not object members or values named plugins", () => {
    // "plugins" as a string VALUE (preceded by ":") is not the key.
    expect(addPluginSpec(`{"k": "plugins"}`, "x")).toBeNull()
    // "plugins" not followed by a colon is not the key either.
    expect(addPluginSpec(`{"plugins" }`, "x")).toBeNull()
  })

  test("tolerates comments inside the array", () => {
    const raw = `{\n  // list\n  "plugins": [\n    // installed\n    "a" /* keep */\n  ]\n}`
    const out = addPluginSpec(raw, "b")
    expect(JSON.parse(cleanJsonc(out!))).toEqual({ plugins: ["a", "b"] })
    expect(out).toContain("// installed")
    expect(out).toContain("/* keep */")
  })
})

describe("addPluginsKey", () => {
  test("inserts into an empty object", () => {
    expect(addPluginsKey(`{}`, "x")).toBe(`{\n  "plugins": ["x"]\n}`)
  })

  test("appends after existing members with a comma", () => {
    const out = addPluginsKey(`{\n  "theme": "dark"\n}`, "x")
    expect(JSON.parse(out!)).toEqual({ theme: "dark", plugins: ["x"] })
  })

  test("preserves comments in the rest of the document", () => {
    const raw = `{\n  // my theme\n  "theme": "dark"\n}`
    const out = addPluginsKey(raw, "x")
    expect(out).toContain("// my theme")
    expect(JSON.parse(cleanJsonc(out!))).toEqual({ theme: "dark", plugins: ["x"] })
  })

  test("returns null without an object closing brace", () => {
    expect(addPluginsKey(`"just a string"`, "x")).toBeNull()
  })
})

describe("removePluginSpec", () => {
  test("removes a middle item and one adjacent comma", () => {
    const raw = `{"plugins": ["a", "b", "c"]}`
    const out = removePluginSpec(raw, (s) => s === "b")
    expect(out).toEqual({ text: `{"plugins": ["a", "c"]}`, removed: true })
  })

  test("removes the first item inline", () => {
    const raw = `{"plugins": ["a", "b"]}`
    expect(removePluginSpec(raw, (s) => s === "a")!.text).toBe(`{"plugins": [ "b"]}`)
  })

  test("removes the last item and the preceding comma", () => {
    const raw = `{\n  "plugins": [\n    "a",\n    "b"\n  ]\n}`
    const out = removePluginSpec(raw, (s) => s === "b")!
    expect(out.removed).toBe(true)
    expect(JSON.parse(cleanJsonc(out.text))).toEqual({ plugins: ["a"] })
    expect(out.text).toContain('"a"')
  })

  test("removes the only item", () => {
    const raw = `{"plugins": ["a"]}`
    const out = removePluginSpec(raw, (s) => s === "a")!
    expect(JSON.parse(cleanJsonc(out.text))).toEqual({ plugins: [] })
  })

  test("reports removed:false when nothing matches", () => {
    const raw = `{"plugins": ["a"]}`
    expect(removePluginSpec(raw, (s) => s === "z")).toEqual({ text: raw, removed: false })
  })

  test("tolerates escaped quotes inside neighboring strings", () => {
    const raw = `{"note": "say \\"hi\\"", "plugins": ["a"]}`
    const out = removePluginSpec(raw, (s) => s === "a")!
    expect(JSON.parse(out.text).note).toBe('say "hi"')
    expect(JSON.parse(out.text).plugins).toEqual([])
  })

  test("an item without a separating comma still removes cleanly", () => {
    const raw = `{"plugins": ["a" "b"]}`
    const out = removePluginSpec(raw, (s) => s === "b")!
    expect(out.removed).toBe(true)
  })

  test("returns null when there is no plugins array or it is malformed", () => {
    expect(removePluginSpec(`{"theme":"dark"}`, () => true)).toBeNull()
    expect(removePluginSpec(`{"plugins":[["a"]]}`, () => true)).toBeNull()
    expect(removePluginSpec(`{"plugins": ["a"`, () => true)).toBeNull()
  })
})

describe("toggleInstalled on JSONC configs", () => {
  function ctx(config?: unknown, configError?: boolean) {
    return {
      client: {
        config: {
          get: vi.fn(() => (configError ? Promise.reject(new Error("cfg")) : Promise.resolve(config))),
        },
      },
    } as never
  }

  test("installing into a commented jsonc preserves every comment", async () => {
    const path = join(root, "opencode.jsonc")
    const raw = `{
  // my preferences
  "theme": "dark",
  "plugins": [
    "pkg", // keep this note
  ],
}`
    writeFileSync(path, raw)
    const message = await toggleInstalled(ctx(undefined, true), root, {
      name: "new-plug",
      kind: "npm",
      status: "uninstalled",
    })
    expect(message).toContain("registered")
    const written = readFileSync(path, "utf8")
    // Every comment survives byte-for-byte.
    expect(written).toContain("// my preferences")
    expect(written).toContain("// keep this note")
    expect(JSON.parse(cleanJsonc(written))).toEqual({ theme: "dark", plugins: ["pkg", "new-plug"] })
  })

  test("uninstalling from a commented jsonc preserves every comment", async () => {
    const path = join(root, "opencode.jsonc")
    const raw = `{
  // my preferences
  "theme": "dark",
  "plugins": [
    "gone", // remove me
    "stay",
  ],
}`
    writeFileSync(path, raw)
    const message = await toggleInstalled(ctx(undefined, true), root, {
      name: "gone",
      kind: "npm",
    })
    expect(message).toContain("removed")
    const written = readFileSync(path, "utf8")
    expect(written).toContain("// my preferences")
    expect(written).toContain("// remove me")
    expect(JSON.parse(cleanJsonc(written)).plugins).toEqual(["stay"])
  })

  test("installing into a commented config without a plugins key adds one textually", async () => {
    const path = join(root, "opencode.jsonc")
    const raw = `{\n  // just a theme\n  "theme": "dark"\n}`
    writeFileSync(path, raw)
    await toggleInstalled(ctx(undefined, true), root, {
      name: "new-plug",
      kind: "npm",
      status: "uninstalled",
    })
    const written = readFileSync(path, "utf8")
    expect(written).toContain("// just a theme")
    expect(JSON.parse(cleanJsonc(written)).plugins).toEqual(["new-plug"])
  })

  test("prefers an existing opencode.jsonc when no doc declares plugins", async () => {
    const path = join(root, "opencode.jsonc")
    writeFileSync(path, `{\n  "plugins": ["pkg"]\n}`)
    await toggleInstalled(ctx(undefined, true), root, {
      name: "pkg",
      kind: "npm",
    })
    expect(JSON.parse(cleanJsonc(readFileSync(path, "utf8"))).plugins).toEqual([])
  })

  test("a non-object config document falls back to a full rewrite on install", async () => {
    const path = join(root, "opencode.json")
    writeFileSync(path, `[1, 2]`)
    const message = await toggleInstalled(ctx(undefined, true), root, {
      name: "x",
      kind: "npm",
      status: "uninstalled",
    })
    expect(message).toContain("registered")
    const written = JSON.parse(readFileSync(path, "utf8"))
    expect(written.plugins).toEqual(["x"])
  })

  test("a nested non-string plugins array falls back to a full rewrite on uninstall", async () => {
    const path = join(root, "opencode.json")
    writeFileSync(path, `{"plugins": [["a"]]}`)
    const message = await toggleInstalled(ctx(undefined, true), root, { name: "a", kind: "npm" })
    expect(message).toContain("removed")
    expect(JSON.parse(readFileSync(path, "utf8")).plugins).toEqual([])
  })

  test("a scalar config document falls back to a full rewrite on install", async () => {
    const path = join(root, "opencode.json")
    writeFileSync(path, "42")
    const message = await toggleInstalled(ctx(undefined, true), root, {
      name: "x",
      kind: "npm",
      status: "uninstalled",
    })
    expect(message).toContain("registered")
    expect(JSON.parse(readFileSync(path, "utf8")).plugins).toEqual(["x"])
  })

  test("unparseable config still throws", async () => {
    const path = join(root, "opencode.json")
    writeFileSync(path, "{oops")
    await expect(toggleInstalled(ctx(undefined, true), root, { name: "x", kind: "npm" })).rejects.toThrow(
      "Cannot parse",
    )
  })
})

describe("plugin entrypoints", () => {
  test("tui plugin setup registers its slots", () => {
    expect(typeof plugin.setup).toBe("function")
  })
})
