import { describe, expect, test, vi } from "vitest"
import { createComponent } from "solid-js"
import { render as renderTree } from "solid-js/web"
import { PluginContextProvider } from "@opencode-ai/plugin/tui"
import plugin from "../tui.js"
import serverPlugin from "../index.js"

// Cold start: empty plugin registry, no config documents, empty durable
// storage, and a workspace with no plugin projects. setup() must complete,
// register both slots, and the widget must render nothing rather than crash.
vi.mock("opencode-plugin-kit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("opencode-plugin-kit")>()
  return {
    ...actual,
    availableProviders: vi.fn(() => []),
  }
})

function emptyCtx(root: string) {
  const slots: Array<Record<string, unknown>> = []
  const ctx: any = {
    storage: {
      store: (_key: string, opts: { initial: unknown }) => [{ ...structuredClone(opts.initial) }],
    },
    ui: {
      slot: (o: Record<string, unknown>) => {
        slots.push(o)
        return () => {}
      },
      toast: { show: () => {} },
      dialog: { alert: () => Promise.resolve(), select: () => Promise.resolve() },
    },
    keymap: { layer: () => {} },
    client: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "plugin") {
            return { list: () => Promise.resolve({ data: [] }) }
          }
          if (prop === "config") {
            return { get: () => Promise.resolve([]) }
          }
          return () => Promise.reject(new Error("cold start: no service"))
        },
        set: () => true,
      },
    ),
    options: {},
    location: { directory: root },
    data: { location: { default: () => ({ directory: root }) } },
    theme: { text: { default: "#fff", subdued: "#888" } },
  }
  return { ctx, slots }
}

describe("cold start", () => {
  test("server entrypoint is a no-op that completes", async () => {
    await expect(Promise.resolve(serverPlugin.setup({} as any))).resolves.toBeUndefined()
  })

  test("setup completes with an empty registry and registers the slots", async () => {
    const { ctx, slots } = emptyCtx("/nonexistent-project")
    const cleanup = await plugin.setup(ctx)
    expect(typeof cleanup).toBe("function")
    const targets = slots.map((s) => s.after ?? s.append ?? s.replace)
    expect(targets).toContain("sidebar.content")
    expect(targets).toContain("app")
    expect(() => cleanup()).not.toThrow()
  })

  test("an empty workspace renders no rows instead of crashing", async () => {
    const { ctx, slots } = emptyCtx("/empty-workspace")
    await plugin.setup(ctx)
    const content = slots.find((s) => s.after === "sidebar.content") as any
    expect(content).toBeTruthy()
    // Mounting the widget against the empty context must not throw; an
    // empty list renders nothing.
    expect(() => {
      const host = document.createElement("div")
      document.body.appendChild(host)
      const tree = createComponent(PluginContextProvider, {
        value: ctx,
        get children() {
          return content.render({ sessionID: "s1" })
        },
      })
      const dispose = renderTree(() => tree, host)
      dispose()
      host.remove()
    }).not.toThrow()
  })

  test("repeated setup on empty stores is idempotent", async () => {
    const { ctx } = emptyCtx("/nonexistent-project")
    await Promise.resolve(plugin.setup(ctx))
    await expect(Promise.resolve(plugin.setup(ctx))).resolves.toBeDefined()
  })
})
