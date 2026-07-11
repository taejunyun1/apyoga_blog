import { render, screen } from "@testing-library/vue"
import { describe, expect, it } from "vitest"

describe("application shell", () => {
  it("shows the product name and new draft action", async () => {
    let HomeView: unknown

    try {
      HomeView = (await import("@/views/HomeView.vue")).default
    } catch {
      HomeView = undefined
    }

    expect(HomeView).toBeDefined()
    render(HomeView as object)
    expect(screen.getByText("A.P YOGA Content Studio")).toBeTruthy()
    expect(screen.getByRole("button", { name: "새 글 만들기" })).toBeTruthy()
  })
})
