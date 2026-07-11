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
  it("moves from prepared photos into the manual-capable mask editor", async () => {
    const repository = new InMemoryRepository()
    configureStudioServices({
      repository,
      faceDetector: { detect: vi.fn().mockResolvedValue([]), lastDiagnostic: "자동 감지를 사용할 수 없어 수동 편집으로 전환했어요." }
    })
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
        stubs: {
          "v-stage": { template: "<div><slot /></div>" },
          "v-layer": { template: "<div><slot /></div>" },
          "v-image": { template: "<div />" },
          "v-group": { template: "<div><slot /></div>" },
          "v-ellipse": { template: "<span />" },
          "v-rect": { template: "<span />" },
          "v-transformer": { template: "<span />" }
        }
      }
    })

    expect(screen.getByText("수련 사진을 선택해 주세요")).toBeTruthy()
    await fireEvent.click(screen.getByRole("button", { name: "얼굴 가림 확인" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "얼굴 추가" })).toBeTruthy())
    expect(store.draft?.step).toBe("mask")
    expect(screen.getByText(/수동으로 얼굴을 추가/)).toBeTruthy()
  })
})
