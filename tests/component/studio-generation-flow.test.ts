import { fireEvent, render, screen, waitFor } from "@testing-library/vue"
import { createPinia, setActivePinia } from "pinia"
import { createMemoryHistory, createRouter } from "vue-router"
import { afterEach, describe, expect, it } from "vitest"
import { LocalAIProvider } from "@/adapters/local-ai-provider"
import StudioView from "@/views/StudioView.vue"
import { createDraft } from "@/domain/studio"
import { configureStudioServices, resetStudioServices, useStudioStore } from "@/features/studio/studio-store"
import { studioImages } from "../fixtures"
import { InMemoryRepository } from "../helpers/in-memory-repository"

afterEach(() => resetStudioServices())

describe("studio generation flow", () => {
  it("moves from memo through brief confirmation to two channel results", async () => {
    const repository = new InMemoryRepository()
    configureStudioServices({ repository, ai: new LocalAIProvider() })
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    const draft = createDraft()
    draft.step = "memo"
    draft.images = studioImages(1).map((image) => ({ ...image, maskConfirmedAt: "2026-07-11T00:05:00.000Z" }))
    store.draft = draft
    repository.drafts.set(draft.id, draft)
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/studio/:draftId", component: StudioView }] })
    await router.push(`/studio/${draft.id}`)
    await router.isReady()
    render(StudioView, { global: { plugins: [pinia, router] } })

    await fireEvent.update(screen.getByLabelText("오늘의 수련 메모"), "어깨와 흉곽을 천천히 열어간 차분한 저녁 수련")
    await fireEvent.click(screen.getByRole("button", { name: "AI 이해 내용 만들기" }))
    await waitFor(() => expect(screen.getByText("AI가 이해한 오늘의 수련")).toBeTruthy())
    await fireEvent.click(screen.getByRole("button", { name: "이해한 내용이 맞아요" }))
    await fireEvent.click(screen.getByRole("button", { name: "두 채널 글 생성" }))

    await waitFor(() => expect(screen.getByRole("tab", { name: "네이버 블로그" })).toBeTruthy())
    expect(screen.getByRole("tab", { name: "인스타그램" })).toBeTruthy()
    expect(store.draft?.naver.status).toBe("success")
    expect(store.draft?.instagram.status).toBe("success")
  })
})
