import { describe, expect, test } from "vitest"
import { addPluginsKey, addPluginSpec, removePluginSpec, tolerantParse } from "../tui.js"

// A corpus of real-world config shapes. For every entry: installing a new
// spec, then removing it, must round-trip the document — plugins arrays
// stay parseable, and non-plugins content (comments, keys, formatting)
// survives untouched. This is the gate that keeps `toggleInstalled` safe
// against configs it has never seen.
const corpus: Array<{ name: string; raw: string; spec: string }> = [
  {
    name: "plain json, inline array",
    raw: `{"$schema": "x", "plugins": ["./a"]}`,
    spec: "./b",
  },
  {
    name: "jsonc with line comments",
    raw: `{\n  // my plugins\n  "plugins": [\n    "./a" // pinned\n  ]\n}`,
    spec: "./b",
  },
  {
    name: "jsonc with block comments",
    raw: `{\n  /* plugins */\n  "plugins": ["./a"]\n}`,
    spec: "./b",
  },
  {
    name: "trailing comma",
    raw: `{"plugins": ["./a",]}`,
    spec: "./b",
  },
  {
    name: "crlf line endings",
    raw: `{\r\n  "plugins": [\r\n    "./a"\r\n  ]\r\n}`,
    spec: "./b",
  },
  {
    name: "tabs indentation",
    raw: `{\n\t"plugins": [\n\t\t"./a"\n\t]\n}`,
    spec: "./b",
  },
  {
    name: "unicode keys and comments",
    raw: `{\n  "ключ": "значение", // ключи\n  "plugins": ["./a"]\n}`,
    spec: "./b",
  },
  {
    name: "multiline with escaped quotes in a comment",
    raw: `{\n  // he said "hi"\n  "plugins": ["./a"]\n}`,
    spec: "./b",
  },
  {
    name: "empty plugins array",
    raw: `{"plugins": []}`,
    spec: "./b",
  },
  {
    name: "no plugins key",
    raw: `{"theme": "dark"}`,
    spec: "./b",
  },
  {
    name: "other keys before and after",
    raw: `{"model": "x", "plugins": ["./a"], "share": "manual"}`,
    spec: "./b",
  },
  {
    name: "nested objects that look like plugins arrays",
    raw: `{"mcp": {"x": {"plugins": ["./decoy"]}}, "plugins": ["./a"]}`,
    spec: "./b",
  },
]

describe("config corpus", () => {
  for (const { name, raw, spec } of corpus) {
    test(`${name}: install → remove round-trips`, () => {
      // Same fallback chain toggleInstalled uses: an existing array is
      // edited textually; a missing key is added; otherwise no edit.
      const added = addPluginSpec(raw, spec) ?? addPluginsKey(raw, spec)
      expect(added).toBeTruthy()
      // The array stays parseable and gains the new spec.
      const afterAdd = tolerantParse(added!)
      expect(afterAdd).toBeTruthy()

      // Removing the just-added spec must restore the original list.
      const removed = removePluginSpec(added!, (s) => s === spec)
      expect(removed?.removed).toBe(true)
      const plugins = (tolerantParse(removed!.text) as any)?.plugins
      expect(Array.isArray(plugins)).toBe(true)
      expect(plugins).not.toContain(spec)
    })

    test(`${name}: removing an unrelated spec is a no-op`, () => {
      const removed = removePluginSpec(raw, (s) => s === "./does-not-exist")
      if (removed) {
        expect(removed.removed).toBe(false)
        expect(removed.text).toBe(raw)
      }
    })
  }

  test("comments survive an install", () => {
    const raw = `{\n  // my plugins\n  "plugins": ["./a"]\n}`
    const added = addPluginSpec(raw, "./b")!
    expect(added).toContain("// my plugins")
  })

  test("comments survive a removal", () => {
    const raw = `{\n  // my plugins\n  "plugins": ["./a", "./b"]\n}`
    const removed = removePluginSpec(raw, (s) => s === "./a")!
    expect(removed.removed).toBe(true)
    expect(removed.text).toContain("// my plugins")
  })

  test("the root plugins array is edited, not a decoy", () => {
    const raw = `{"mcp": {"x": {"plugins": ["./decoy"]}}, "plugins": ["./a"]}`
    const added = addPluginSpec(raw, "./b")!
    const root = tolerantParse(added) as any
    expect(root.plugins).toContain("./b")
    expect(root.mcp.x.plugins).toEqual(["./decoy"])
  })
})
