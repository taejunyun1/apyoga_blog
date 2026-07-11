import { describe, expect, it, vi } from "vitest"
import { BrowserClipboard } from "@/adapters/browser-clipboard"

describe("BrowserClipboard", () => {
  it("reports a successful copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const clipboard = new BrowserClipboard({ writeText })

    await expect(clipboard.copy("복사할 글")).resolves.toEqual({ ok: true })
    expect(writeText).toHaveBeenCalledWith("복사할 글")
  })

  it("returns a fallback message instead of throwing", async () => {
    const clipboard = new BrowserClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) })

    await expect(clipboard.copy("복사할 글")).resolves.toEqual({ ok: false, error: "클립보드에 복사하지 못했어요." })
  })
})
