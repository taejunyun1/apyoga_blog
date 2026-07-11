import { createPinia, setActivePinia } from "pinia"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LocalAIProvider } from "@/adapters/local-ai-provider"
import { createDraft, type ContentBrief, type InstagramOutput } from "@/domain/studio"
import { configureStudioServices, resetStudioServices, useStudioStore } from "@/features/studio/studio-store"
import { analyzeInput, studioImages } from "../fixtures"
import { InMemoryRepository } from "../helpers/in-memory-repository"

const brief: ContentBrief = {
  classSummary: analyzeInput.memo,
  overallMood: "차분한 수련의 분위기",
  bodyFocus: ["어깨", "흉곽"],
  visualKeywords: ["호흡"],
  imageDescriptions: [],
  recommendedCoverImageId: "image-1",
  recommendedImageOrder: ["image-1", "image-2"],
  uncertainClaims: [],
  seasonalContext: "",
  userMemoSummary: analyzeInput.memo
}

function readyDraft() {
  return {
    ...createDraft("2026-07-11T00:00:00.000Z"),
    sourceMemo: analyzeInput.memo,
    mustInclude: analyzeInput.mustInclude,
    avoid: analyzeInput.avoid,
    writingMode: analyzeInput.writingMode,
    naverTone: analyzeInput.naverTone,
    instagramTone: analyzeInput.instagramTone,
    images: studioImages(2).map((image) => ({ ...image, maskConfirmedAt: "2026-07-11T00:05:00.000Z" })),
    brief,
    briefConfirmed: true
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  resetStudioServices()
})

describe("studio workflow store", () => {
  it("creates and immediately persists a new draft", async () => {
    const repository = new InMemoryRepository()
    configureStudioServices({ repository })
    const store = useStudioStore()

    const draft = await store.create("2026-07-11T00:00:00.000Z")

    expect(draft.step).toBe("photos")
    expect(repository.saveCalls).toBe(1)
  })

  it("preserves Naver when Instagram generation fails", async () => {
    const repository = new InMemoryRepository()
    class PartialProvider extends LocalAIProvider {
      override async generateInstagram(): Promise<InstagramOutput> {
        throw new Error("instagram unavailable")
      }
    }
    configureStudioServices({ repository, ai: new PartialProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()

    await store.generateAll()

    expect(store.draft?.naver.status).toBe("success")
    expect(store.draft?.instagram.status).toBe("error")
    expect(store.draft?.step).toBe("results")
  })

  it("never analyzes images while rewriting one section", async () => {
    const repository = new InMemoryRepository()
    const ai = new LocalAIProvider()
    const analyzeSpy = vi.spyOn(ai, "analyzeImages")
    configureStudioServices({ repository, ai })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()
    analyzeSpy.mockClear()

    const previousBody = store.draft?.naver.data?.body
    await store.rewrite({ channel: "naver", section: "intro", instruction: "감성 줄이기" })

    expect(analyzeSpy).not.toHaveBeenCalled()
    expect(store.draft?.naver.data?.body).toBe(previousBody)
    expect(store.draft?.naver.data?.introOptions[0]).toContain("호흡")
  })

  it("refuses generation before explicit brief confirmation", async () => {
    configureStudioServices({ repository: new InMemoryRepository() })
    const store = useStudioStore()
    store.draft = { ...readyDraft(), briefConfirmed: false }

    await expect(store.generateAll()).rejects.toThrow("AI가 이해한 내용을 확인")
  })
})
