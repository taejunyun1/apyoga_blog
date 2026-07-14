import { fireEvent, render, screen, waitFor } from "@testing-library/vue"
import { createPinia, setActivePinia } from "pinia"
import { createMemoryHistory, createRouter } from "vue-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import StudioView from "@/views/StudioView.vue"
import { createDraft } from "@/domain/studio"
import { configureStudioServices, resetStudioServices, useStudioStore } from "@/features/studio/studio-store"
import { studioImages } from "../fixtures"
import { InMemoryRepository } from "../helpers/in-memory-repository"

afterEach(() => resetStudioServices())

describe("studio photo flow", () => {
  it("moves directly from prepared photos to ordering without a face-mask step", async () => {
    const repository = new InMemoryRepository()
    configureStudioServices({ repository })
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    store.draft = { ...createDraft(), images: studioImages(1) }
    repository.drafts.set(store.draft.id, store.draft)
    repository.images.set(store.draft.images[0].editedBlobId, new Blob(["pixels"]))
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/studio/:draftId", component: StudioView }]
    })
    await router.push(`/studio/${store.draft.id}`)
    await router.isReady()

    render(StudioView, {
      global: {
        plugins: [pinia, router],
        stubs: {}
      }
    })

    expect(screen.getByText("수련 사진을 선택해 주세요")).toBeTruthy()
    expect(screen.queryByText("가림")).toBeNull()
    await fireEvent.click(screen.getByRole("button", { name: "사진 순서 정하기" }))
    await waitFor(() => expect(screen.getByRole("heading", { name: "사진 순서와 대표 사진" })).toBeTruthy())
    expect(store.draft?.step).toBe("organize")
  })
})
