import { render, screen } from "@testing-library/vue"
import { createPinia } from "pinia"
import { createMemoryHistory, createRouter } from "vue-router"
import { describe, expect, it } from "vitest"
import { resetStudioServices } from "@/features/studio/studio-store"

describe("application shell", () => {
  it("shows the product name and new draft action", async () => {
    let HomeView: unknown

    try {
      HomeView = (await import("@/views/HomeView.vue")).default
    } catch {
      HomeView = undefined
    }

    expect(HomeView).toBeDefined()
    resetStudioServices()
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: HomeView as object }, { path: "/studio/:draftId", component: { template: "<div />" } }]
    })
    await router.push("/")
    await router.isReady()
    render(HomeView as object, { global: { plugins: [createPinia(), router] } })
    expect(screen.getByText("A.P YOGA Content Studio")).toBeTruthy()
    expect(screen.getByRole("button", { name: "새 글 만들기" })).toBeTruthy()
  })
})
