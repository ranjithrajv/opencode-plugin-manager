import { describe, expect, test } from "vitest"
import { describeBuiltin } from "../builtins.js"

describe("describeBuiltin", () => {
  test("curated overrides win", () => {
    expect(describeBuiltin("opencode.browser")).toContain("browser")
    expect(describeBuiltin("opencode.skill")).toContain("skills")
    expect(describeBuiltin("opencode.vcs.git")).toContain("Git")
  })

  test("category generation for systematic families", () => {
    expect(describeBuiltin("opencode.tool.read")).toContain("read")
    expect(describeBuiltin("opencode.provider.anthropic")).toContain("anthropic")
    expect(describeBuiltin("opencode.config.mcp")).toContain("mcp")
    expect(describeBuiltin("opencode.websearch.exa")).toContain("exa")
  })

  test("safe fallback for unknown shapes", () => {
    expect(describeBuiltin("opencode.unknown.thing")).toContain("unknown")
    expect(describeBuiltin("weird-id")).toBeTruthy()
    expect(describeBuiltin("")).toBeTruthy()
  })
})
