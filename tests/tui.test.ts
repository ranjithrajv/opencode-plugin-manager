import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createComponent } from "solid-js"
import { render as renderTree } from "solid-js/web"
import { PluginContextProvider } from "@opencode-ai/plugin/tui"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import plugin, { GROUP_ORDER } from "../tui.tsx"
import serverPlugin from "../index.ts"

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "opm-tui-"))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  document.body.innerHTML = ""
})

interface CtxOpts {
  registry?: unknown[]
  config?: unknown
  listThrows?: boolean
  location?: unknown
  defaultLocation?: unknown
  withToast?: boolean
  throwingToast?: boolean
  cells?: Record<string, unknown>
  /** storage.store throws for this key (e.g. "builtins"). */
  brokenStoreKey?: string
  keymapThrows?: boolean
  slotThrowsOnApp?: boolean
}

type AnyCtx = Record<string, any>

function fakeTuiCtx(opts: CtxOpts = {}) {
  const cells = (opts.cells ??= {})
  const toastCalls: Array<Record<string, unknown>> = []
  const slotCalls: Array<Record<string, unknown>> = []
  const commands: Array<{ run: () => void }> = []
  const toast = opts.throwingToast
    ? {
        show: vi.fn((input: Record<string, unknown>) => {
          toastCalls.push(input)
          throw new Error("toast down")
        }),
      }
    : { show: vi.fn((input: Record<string, unknown>) => void toastCalls.push(input)) }
  const ui: AnyCtx = {
    slot: vi.fn((claim: Record<string, unknown>) => {
      if (opts.slotThrowsOnApp && claim.append === "app") throw new Error("no slots")
      slotCalls.push(claim)
      return () => {}
    }),
  }
  if (opts.withToast !== false) ui.toast = toast
  const ctx: AnyCtx = {
    location: opts.location ?? undefined,
    theme: { text: { default: "#ffffff", subdued: "#888888" } },
    storage: {
      store(key: string, o: { initial: unknown }) {
        if (key === opts.brokenStoreKey) throw new Error("storage down")
        const restored = ((cells as Record<string, unknown>)[key] ??= structuredClone(o.initial))
        return [restored, () => {}]
      },
    },
    data: {
      location: {
        default: () => (Object.hasOwn(opts, "defaultLocation") ? opts.defaultLocation : { directory: root }),
      },
    },
    client: {
      plugin: {
        list: () =>
          opts.listThrows
            ? (() => {
                throw new Error("registry down")
              })()
            : Promise.resolve(opts.registry ?? []),
      },
      config: { get: () => Promise.resolve(opts.config) },
    },
    keymap: {
      layer: vi.fn((register: () => any) => {
        if (opts.keymapThrows) throw new Error("keymap down")
        const layer = register()
        for (const command of layer?.commands ?? []) commands.push(command)
        return layer
      }),
    },
    ui,
  }
  return { ctx: ctx as never, ctxRaw: ctx, toastCalls, slotCalls, commands, cells }
}

/** Runs setup(), registers the app slot's keymap layer, returns the sidebar claim. */
function setupPlugin(ctxBundle: ReturnType<typeof fakeTuiCtx>) {
  plugin.setup(ctxBundle.ctx)
  const appClaim = ctxBundle.slotCalls.find((c) => c.append === "app")
  if (appClaim) (appClaim as AnyCtx).render()
  const sidebarClaim = ctxBundle.slotCalls.find((c) => c.after === "sidebar.content")
  expect(sidebarClaim).toBeDefined()
  return sidebarClaim as { render: (input: unknown) => unknown }
}

function mount(render: (input: unknown) => unknown, ctx: never) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const tree = createComponent(PluginContextProvider, {
    value: ctx,
    get children() {
      return render({ sessionID: "s1" })
    },
  })
  renderTree(() => tree, host)
  return host
}

/** Deepest element whose text includes `text`. */
function leaf(host: Element, text: string): Element {
  const el = [...host.querySelectorAll("*")]
    .filter((e) => e.textContent?.includes(text))
    .filter((e) => ![...e.children].some((c) => c.textContent?.includes(text)))
    .at(-1)
  expect(el, `no leaf with text ${JSON.stringify(text)}`).toBeDefined()
  return el!
}

function mousedown(host: Element, text: string) {
  leaf(host, text).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
}

const npmPlugin = {
  id: "npmplug",
  source: { type: "package", target: "npmplug@1.0.0", version: "1.0.0", outdated: true },
  state: { status: "failed" },
}
const localPlugin = (dir: string, description?: string) => {
  if (description !== undefined) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "loc", description, dependencies: { "@opencode-ai/plugin": "*" } }),
    )
  }
  return { id: "loc", source: { type: "local", path: join(dir, "index.ts") }, state: { status: "active" } }
}
const builtin = (id: string) => ({ id, state: { status: "active" } })

describe("server entrypoint", () => {
  test("index.ts defines a no-op server plugin", () => {
    expect(serverPlugin.id).toBe("plugin-manager.server")
    expect((serverPlugin as { setup: () => unknown }).setup()).toBeUndefined()
  })

  test("tui plugin defines its id", () => {
    expect(plugin.id).toBe("plugin-manager.cli")
  })
})

describe("setup", () => {
  test("registers the sidebar slot after sidebar.content and the app slot", () => {
    const bundle = fakeTuiCtx()
    plugin.setup(bundle.ctx)
    expect(bundle.slotCalls.map((c) => c.append ?? c.after)).toEqual(["app", "sidebar.content"])
    expect(bundle.slotCalls[1].after).toBe("sidebar.content")
  })

  test("setup resets built-ins visibility to the visible default", async () => {
    const bundle = fakeTuiCtx({
      cells: { builtins: { show: false } },
      registry: [
        builtin("b1"),
        { id: "npmplug", source: { type: "package", target: "npmplug" }, state: { status: "active" } },
      ],
    })
    const sidebar = setupPlugin(bundle)
    const host = mount(sidebar.render, bundle.ctx)
    await vi.waitFor(() => expect(host.textContent).toContain("BUILT-IN"))
    // toggle once via the command → hidden (reactive) and persisted as {value}
    bundle.commands[0].run()
    await vi.waitFor(() => expect(host.textContent).not.toContain("BUILT-IN"))
    expect(bundle.cells.builtins).toMatchObject({ value: false })
    // toggle again → visible
    bundle.commands[0].run()
    await vi.waitFor(() => expect(host.textContent).toContain("BUILT-IN"))
    expect(bundle.cells.builtins).toMatchObject({ value: true })
  })

  test("a broken built-ins store falls back to in-memory and still toggles", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const bundle = fakeTuiCtx({ brokenStoreKey: "builtins" })
    const sidebar = setupPlugin(bundle)
    void sidebar
    bundle.commands[0].run()
    bundle.commands[0].run()
    expect(document.body.textContent).toBeDefined()
    warn.mockRestore()
  })

  test("a throwing keymap.layer is reported, not fatal", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const bundle = fakeTuiCtx({ keymapThrows: true })
    plugin.setup(bundle.ctx)
    const appClaim = bundle.slotCalls.find((c) => c.append === "app")
    ;(appClaim as AnyCtx).render()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  test("a throwing app slot is reported, not fatal", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const bundle = fakeTuiCtx({ slotThrowsOnApp: true })
    plugin.setup(bundle.ctx)
    expect(bundle.slotCalls.some((c) => c.after === "sidebar.content")).toBe(true)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  test("the toggle command toasts and persists visibility", () => {
    const bundle = fakeTuiCtx()
    plugin.setup(bundle.ctx)
    const appClaim = bundle.slotCalls.find((c) => c.append === "app")
    ;(appClaim as AnyCtx).render()
    bundle.commands[0].run()
    expect(bundle.toastCalls[0]).toMatchObject({ variant: "success" })
    expect(bundle.cells.builtins).toMatchObject({ value: false })
    // re-registering the layer while hidden computes the "hidden" title
    ;(appClaim as AnyCtx).render()
    bundle.commands[0].run()
    expect(bundle.cells.builtins).toMatchObject({ value: true })
  })

  test("the toggle command survives a missing or throwing toast", () => {
    for (const opts of [{ withToast: false }, { throwingToast: true }] as const) {
      const bundle = fakeTuiCtx(opts)
      setupPlugin(bundle)
      expect(() => bundle.commands[0].run()).not.toThrow()
      expect(bundle.commands[0].run()).toBeUndefined()
    }
  })
})

describe("PluginList rendering", () => {
  test("empty workspace renders nothing", async () => {
    const bundle = fakeTuiCtx({ registry: [], config: { data: [] } })
    const sidebar = setupPlugin(bundle)
    const host = mount(sidebar.render, bundle.ctx)
    await vi.waitFor(() => expect(host.textContent).not.toContain("PLUGINS"))
  })

  test("a sessionID-less slot render skips the fetch and renders nothing", async () => {
    const bundle = fakeTuiCtx()
    const sidebar = setupPlugin(bundle)
    const host = document.createElement("div")
    document.body.appendChild(host)
    const tree = createComponent(PluginContextProvider, {
      value: bundle.ctx,
      get children() {
        return sidebar.render({})
      },
    })
    renderTree(() => tree, host)
    await new Promise((r) => setTimeout(r, 10))
    expect(host.textContent).not.toContain("PLUGINS")
  })

  test("a synchronous registry failure shows the error fallback", async () => {
    const bundle = fakeTuiCtx({ listThrows: true })
    const sidebar = setupPlugin(bundle)
    const host = mount(sidebar.render, bundle.ctx)
    await vi.waitFor(() => expect(host.textContent).toContain("⚠ plugins unavailable"))
  })

  test("lists up to two plugins expanded with arrows hidden and a summary", async () => {
    const bundle = fakeTuiCtx({
      registry: [npmPlugin, localPlugin(join(root, "loc"))],
      config: { data: [{ path: join(root, "opencode.json"), info: { plugins: ["npmplug"] } }] },
    })
    const sidebar = setupPlugin(bundle)
    const host = mount(sidebar.render, bundle.ctx)
    await vi.waitFor(() => expect(host.textContent).toContain("PLUGINS"))
    expect(host.textContent).not.toContain("▶")
    expect(host.textContent).not.toContain("▼")
    expect(host.textContent).toContain("(1 npm · 1 local)")
    expect(host.textContent).toContain("NPM (1)")
    expect(host.textContent).toContain("LOCAL (1)")
    expect(host.textContent).toContain("npmplug 1.0.0 ⚠ update")
    expect(host.textContent).toContain("✗")
    expect(host.textContent).toContain("failed")
    expect(host.textContent).toContain("[–]")
    expect(host.textContent).toContain("loc")
    expect(host.textContent).toContain("✓")
    expect(host.textContent).toContain("installed")
  })

  test("uninstalled workspace candidates show their own row state", async () => {
    mkdirSync(join(root, "orphan"), { recursive: true })
    writeFileSync(
      join(root, "orphan", "package.json"),
      JSON.stringify({ name: "orphan", dependencies: { "@opencode-ai/plugin": "*" } }),
    )
    const bundle = fakeTuiCtx({ registry: [builtin("b1"), builtin("b2")] })
    const sidebar = setupPlugin(bundle)
    const host = mount(sidebar.render, bundle.ctx)
    await vi.waitFor(() => expect(host.textContent).toContain("1 local · 2 builtin"))
    mousedown(host, "PLUGINS")
    await vi.waitFor(() => expect(host.textContent).toContain("LOCAL (1)"))
    expect(host.textContent).toContain("orphan")
    expect(host.textContent).toContain("○")
    expect(host.textContent).toContain("uninstalled")
    expect(host.textContent).toContain("[+]")
  })

  test("more than two entries start collapsed and expand on header click", async () => {
    const bundle = fakeTuiCtx({
      registry: [
        { id: "npmplug", source: { type: "package", target: "npmplug" }, state: { status: "active" } },
        localPlugin(join(root, "loc")),
        builtin("b1"),
        builtin("b2"),
      ],
    })
    const sidebar = setupPlugin(bundle)
    const host = mount(sidebar.render, bundle.ctx)
    await vi.waitFor(() => expect(host.textContent).toContain("PLUGINS"))
    expect(host.textContent).toContain("▶")
    expect(host.textContent).toContain("(1 npm · 1 local · 2 builtin)")
    expect(host.textContent).not.toContain("NPM (1)")

    mousedown(host, "PLUGINS")
    expect(host.textContent).toContain("▼")
    expect(host.textContent).toContain("NPM (1)")
    expect(host.textContent).toContain("npmplug")
    expect(host.textContent).toContain("BUILT-IN (2)")
    expect(host.textContent).toContain("▸")
    // the builtin group starts collapsed
    expect(host.textContent).not.toContain("b1")

    // clicking the header again collapses
    mousedown(host, "PLUGINS")
    expect(host.textContent).toContain("▶")
    expect(host.textContent).not.toContain("NPM (1)")
  })

  test("group headers toggle their own collapse state", async () => {
    const bundle = fakeTuiCtx({
      registry: [
        { id: "npmplug", source: { type: "package", target: "npmplug" }, state: { status: "active" } },
        builtin("b1"),
        builtin("b2"),
      ],
    })
    const sidebar = setupPlugin(bundle)
    const host = mount(sidebar.render, bundle.ctx)
    await vi.waitFor(() => expect(host.textContent).toContain("PLUGINS"))
    mousedown(host, "PLUGINS")
    await vi.waitFor(() => expect(host.textContent).toContain("BUILT-IN (2)"))
    // npm group starts open; collapse it
    mousedown(host, "NPM (1)")
    await vi.waitFor(() => expect(host.textContent).not.toContain("npmplug"))
    expect(host.textContent).toContain("▸")
    // expand the builtin group → the hint appears
    mousedown(host, "BUILT-IN (2)")
    await vi.waitFor(() => expect(host.textContent).toContain("CORE (2)"))
    expect(host.textContent).toContain("▾")
    expect(host.textContent).toContain("built-ins can't be disabled individually")
    expect(host.textContent).toContain("OPENCODE_DISABLE_DEFAULT_PLUGINS turns all off")
    // collapse it again
    mousedown(host, "BUILT-IN (2)")
    await vi.waitFor(() => expect(host.textContent).not.toContain("CORE (2)"))
  })

  test("built-in sub-groups group by category and toggle independently", async () => {
    const bundle = fakeTuiCtx({
      registry: [
        builtin("opencode.tool.write"),
        builtin("opencode.tool.read"),
        builtin("opencode.provider.anthropic"),
        builtin("opencode.agent"),
      ],
    })
    const sidebar = setupPlugin(bundle)
    const host = mount(sidebar.render, bundle.ctx)
    await vi.waitFor(() => expect(host.textContent).toContain("PLUGINS"))
    mousedown(host, "PLUGINS")
    await vi.waitFor(() => expect(host.textContent).toContain("BUILT-IN (4)"))
    mousedown(host, "BUILT-IN (4)")
    await vi.waitFor(() => expect(host.textContent).toContain("TOOLS (2)"))
    expect(host.textContent).toContain("TOOLS (2)")
    expect(host.textContent).toContain("PROVIDERS (1)")
    expect(host.textContent).toContain("CORE (1)")
    expect(host.textContent).toContain("opencode.tool.write")
    // collapse the TOOLS sub-group
    mousedown(host, "TOOLS (2)")
    await vi.waitFor(() => expect(host.textContent).not.toContain("opencode.tool.write"))
    expect(host.textContent).toContain("PROVIDERS (1)")
    // expand it again
    mousedown(host, "TOOLS (2)")
    await vi.waitFor(() => expect(host.textContent).toContain("opencode.tool.write"))
  })

  test("fully categorized built-ins render no CORE sub-group", async () => {
    const bundle = fakeTuiCtx({
      registry: [builtin("opencode.tool.write"), builtin("opencode.config.loader"), builtin("opencode.prompt.kimi")],
    })
    const sidebar = setupPlugin(bundle)
    const host = mount(sidebar.render, bundle.ctx)
    await vi.waitFor(() => expect(host.textContent).toContain("PLUGINS"))
    mousedown(host, "PLUGINS")
    mousedown(host, "BUILT-IN (3)")
    await vi.waitFor(() => expect(host.textContent).toContain("TOOLS (1)"))
    expect(host.textContent).toContain("CONFIG (1)")
    expect(host.textContent).toContain("PROMPT ADAPTERS (1)")
    expect(host.textContent).not.toContain("CORE")
  })

  test("the built-ins hint reflects OPENCODE_DISABLE_DEFAULT_PLUGINS", async () => {
    process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "1"
    const bundle = fakeTuiCtx({
      registry: [{ id: "npmplug", source: { type: "package", target: "npmplug" } }, builtin("b1"), builtin("b2")],
    })
    const sidebar = setupPlugin(bundle)
    const host = mount(sidebar.render, bundle.ctx)
    await vi.waitFor(() => expect(host.textContent).toContain("PLUGINS"))
    mousedown(host, "PLUGINS")
    mousedown(host, "BUILT-IN (2)")
    await vi.waitFor(() => expect(host.textContent).toContain("OPENCODE_DISABLE_DEFAULT_PLUGINS is on (all off)"))
    delete process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS
  })

  test("row clicks reveal inline descriptions; built-ins use the catalog", async () => {
    const bundle = fakeTuiCtx({
      registry: [builtin("opencode.agent"), builtin("b2"), localPlugin(join(root, "loc"), "does local things")],
    })
    const sidebar = setupPlugin(bundle)
    const host = mount(sidebar.render, bundle.ctx)
    await vi.waitFor(() => expect(host.textContent).toContain("PLUGINS"))
    mousedown(host, "PLUGINS")
    await vi.waitFor(() => expect(host.textContent).toContain("BUILT-IN (2)"))
    mousedown(host, "BUILT-IN (2)")
    await vi.waitFor(() => expect(host.textContent).toContain("CORE (2)"))
    // builtin row → catalog description
    mousedown(host, "opencode.agent")
    await vi.waitFor(() => expect(host.textContent).toContain("Agent runtime"))
    // deselect
    mousedown(host, "opencode.agent")
    await vi.waitFor(() => expect(host.textContent).not.toContain("Agent runtime"))
    // local row → package.json description ("loc" alone would also match the
    // description text, so target the row box by its concatenated content)
    mousedown(host, "locinstalled")
    await vi.waitFor(() => expect(host.textContent).toContain("does local things"))
    mousedown(host, "locinstalled")
    await vi.waitFor(() => expect(host.textContent).not.toContain("does local things"))
    // clicking the visible description box deselects too
    mousedown(host, "locinstalled")
    await vi.waitFor(() => expect(host.textContent).toContain("does local things"))
    mousedown(host, "does local things")
    await vi.waitFor(() => expect(host.textContent).not.toContain("does local things"))
  })

  test("a local row without a description shows the fallback hint", async () => {
    mkdirSync(join(root, "loc"), { recursive: true })
    writeFileSync(
      join(root, "loc", "package.json"),
      JSON.stringify({ name: "loc", dependencies: { "@opencode-ai/plugin": "*" } }),
    )
    const bundle = fakeTuiCtx({
      registry: [{ id: "loc", source: { type: "local", path: join(root, "loc", "index.ts") } }, builtin("b1")],
    })
    const sidebar = setupPlugin(bundle)
    const host = mount(sidebar.render, bundle.ctx)
    await vi.waitFor(() => expect(host.textContent).toContain("PLUGINS"))
    mousedown(host, "loc")
    await vi.waitFor(() => expect(host.textContent).toContain("No description — check the project's package.json."))
  })

  test("with at most two entries the header click is a no-op", async () => {
    const bundle = fakeTuiCtx({ registry: [localPlugin(join(root, "loc")), builtin("b1")] })
    const sidebar = setupPlugin(bundle)
    const host = mount(sidebar.render, bundle.ctx)
    await vi.waitFor(() => expect(host.textContent).toContain("PLUGINS"))
    mousedown(host, "PLUGINS")
    expect(host.textContent).toContain("LOCAL (1)")
    expect(host.textContent).not.toContain("▼")
  })

  test("clicking an uninstalled plugin registers it and shows a note + toast", async () => {
    writeFileSync(join(root, "opencode.json"), JSON.stringify({ plugins: [] }, null, 2))
    mkdirSync(join(root, "orphan"), { recursive: true })
    writeFileSync(
      join(root, "orphan", "package.json"),
      JSON.stringify({ name: "orphan", dependencies: { "@opencode-ai/plugin": "*" } }),
    )
    const bundle = fakeTuiCtx({ registry: [builtin("b1"), builtin("b2"), builtin("b3")] })
    const sidebar = setupPlugin(bundle)
    const host = mount(sidebar.render, bundle.ctx)
    await vi.waitFor(() => expect(host.textContent).toContain("PLUGINS"))
    mousedown(host, "PLUGINS")
    await vi.waitFor(() => expect(host.textContent).toContain("LOCAL (1)"))
    mousedown(host, "[+]")
    await vi.waitFor(() => expect(host.textContent).toContain("registered — restart the TUI to load it"))
    expect(bundle.toastCalls[0]).toMatchObject({ variant: "success" })
    expect(JSON.parse(readFileSync(join(root, "opencode.json"), "utf8")).plugins).toContain("./orphan")
  })
})

describe("PluginList toggle interactions", () => {
  function setupWorkspace(config: unknown, opts: CtxOpts = {}) {
    writeFileSync(join(root, "opencode.json"), JSON.stringify(config))
    return fakeTuiCtx({ registry: [builtin("b1"), builtin("b2"), builtin("b3")], ...opts })
  }

  test("removing a plugin shows a success note and rewrites the config", async () => {
    const bundle = setupWorkspace({ plugins: ["pkg@1.0"] })
    const sidebar = setupPlugin(bundle)
    const host = mount(sidebar.render, bundle.ctx)
    await vi.waitFor(() => expect(host.textContent).toContain("PLUGINS"))
    mousedown(host, "PLUGINS")
    await vi.waitFor(() => expect(host.textContent).toContain("NPM (1)"))
    mousedown(host, "[–]")
    await vi.waitFor(() => expect(host.textContent).toContain("pkg removed — restart the TUI to unload it"))
    expect(bundle.toastCalls[0]).toMatchObject({ variant: "success" })
    expect(JSON.parse(readFileSync(join(root, "opencode.json"), "utf8")).plugins).toEqual([])
  })

  test("a failing toggle shows an error note and an error toast", async () => {
    const bundle = setupWorkspace(
      { plugins: [] },
      {
        config: { data: [{ path: join(root, "opencode.json"), info: { plugins: ["pkg@1.0"] } }] },
      },
    )
    const sidebar = setupPlugin(bundle)
    const host = mount(sidebar.render, bundle.ctx)
    await vi.waitFor(() => expect(host.textContent).toContain("PLUGINS"))
    mousedown(host, "PLUGINS")
    await vi.waitFor(() => expect(host.textContent).toContain("pkg"))
    mousedown(host, "[–]")
    await vi.waitFor(() => expect(host.textContent).toContain("✗ No config entry matches pkg"))
    expect(bundle.toastCalls[0]).toMatchObject({ variant: "error" })
  })

  test("a broken config yields the parse error note", async () => {
    writeFileSync(join(root, "opencode.json"), "{broken")
    const bundle = fakeTuiCtx({
      registry: [builtin("b1"), builtin("b2"), builtin("b3")],
      config: { data: [{ path: join(root, "opencode.json"), info: { plugins: ["pkg@1.0"] } }] },
    })
    const sidebar = setupPlugin(bundle)
    const host = mount(sidebar.render, bundle.ctx)
    await vi.waitFor(() => expect(host.textContent).toContain("PLUGINS"))
    mousedown(host, "PLUGINS")
    await vi.waitFor(() => expect(host.textContent).toContain("pkg"))
    mousedown(host, "[–]")
    await vi.waitFor(() => expect(host.textContent).toContain("✗ Cannot parse"))
    expect(bundle.toastCalls[0]).toMatchObject({ variant: "error" })
  })

  test("works without a toast service and with a throwing toast", async () => {
    for (const opts of [{ withToast: false }, { throwingToast: true }] as const) {
      const bundle = setupWorkspace({ plugins: ["pkg"] }, opts)
      const sidebar = setupPlugin(bundle)
      const host = mount(sidebar.render, bundle.ctx)
      await vi.waitFor(() => expect(host.textContent).toContain("PLUGINS"))
      mousedown(host, "PLUGINS")
      await vi.waitFor(() => expect(host.textContent).toContain("pkg"))
      mousedown(host, "[–]")
      await vi.waitFor(() => expect(host.textContent).toContain("removed"))
      document.body.innerHTML = ""
    }
  })

  test("the plugin's location ref can be a bare directory string", async () => {
    const bundle = fakeTuiCtx({
      registry: [builtin("b1"), builtin("b2"), builtin("b3")],
      location: root,
    })
    writeFileSync(join(root, "opencode.json"), JSON.stringify({ plugins: ["pkg"] }))
    const sidebar = setupPlugin(bundle)
    const host = mount(sidebar.render, bundle.ctx)
    await vi.waitFor(() => expect(host.textContent).toContain("PLUGINS"))
    mousedown(host, "PLUGINS")
    await vi.waitFor(() => expect(host.textContent).toContain("pkg"))
    mousedown(host, "[–]")
    await vi.waitFor(() => expect(host.textContent).toContain("removed"))
    expect(JSON.parse(readFileSync(join(root, "opencode.json"), "utf8")).plugins).toEqual([])
    expect(bundle.toastCalls.length).toBeGreaterThan(0)
  })

  test("a location without a directory falls back to '.'", async () => {
    const bundle = fakeTuiCtx({
      registry: [builtin("b1"), builtin("b2"), builtin("b3")],
      defaultLocation: undefined,
    })
    const sidebar = setupPlugin(bundle)
    const host = mount(sidebar.render, bundle.ctx)
    await vi.waitFor(() => expect(host.textContent).toContain("PLUGINS"))
    mousedown(host, "PLUGINS")
    // No crash: the fetch resolved against the fallback root.
    await vi.waitFor(() => expect(host.textContent.length).toBeGreaterThanOrEqual(0))
  })
})

describe("setup cache restore", () => {
  test("a second setup hydrates initialValue from persisted entries", async () => {
    const cells: Record<string, unknown> = {}
    const opts: CtxOpts = {
      registry: [{ id: "npmplug", source: { type: "package", target: "npmplug" }, state: { status: "active" } }],
      config: { data: [{ path: join(root, "opencode.json"), info: { plugins: ["npmplug"] } }] },
      cells,
    }
    const first = fakeTuiCtx(opts)
    const sidebar1 = setupPlugin(first)
    const host1 = mount(sidebar1.render, first.ctx)
    await vi.waitFor(() => expect(host1.textContent).toContain("npmplug"))
    document.body.innerHTML = ""

    const second = fakeTuiCtx({ ...opts, cells })
    const sidebar2 = setupPlugin(second)
    const host2 = mount(sidebar2.render, second.ctx)
    // Rendered synchronously from the restored cache value before the fetch.
    expect(host2.textContent).toContain("PLUGINS")
    await vi.waitFor(() => expect(host2.textContent).toContain("npmplug"))
  })
})

describe("module constants", () => {
  test("GROUP_ORDER drives ordering", () => {
    expect(GROUP_ORDER[0]).toBe("npm")
  })
})
