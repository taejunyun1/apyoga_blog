import { render, screen, waitFor } from "@testing-library/vue"
import { createPinia } from "pinia"
import { createMemoryHistory, createRouter } from "vue-router"
import { afterEach, describe, expect, it } from "vitest"
import HomeView from "@/views/HomeView.vue"
import { createDraft } from "@/domain/studio"
import { configureStudioServices, resetStudioServices } from "@/features/studio/studio-store"
import { InMemoryRepository } from "../helpers/in-memory-repository"

afterEach(() => resetStudioServices())

describe("draft restore", () => {
  it("lists a saved draft after expiry cleanup", async () => {
    const repository = new InMemoryRepository()
    const draft = { ...createDraft("2026-07-11T00:00:00.000Z"), title: "저녁 수련 기록", updatedAt: "2026-07-11T01:00:00.000Z" }
    repository.drafts.set(draft.id, draft)
    configureStudioServices({ repository })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: HomeView }, { path: "/studio/:draftId", component: { template: "<div />" } }]
    })
    await router.push("/")
    await router.isReady()

    render(HomeView, { global: { plugins: [createPinia(), router] } })

    await waitFor(() => expect(screen.getByText("저녁 수련 기록")).toBeTruthy())
    expect(screen.getByRole("link", { name: /저녁 수련 기록/ }).getAttribute("href")).toBe(`/studio/${draft.id}`)
  })
})
