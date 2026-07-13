import { createPinia, setActivePinia } from "pinia"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LocalAIProvider } from "@/adapters/local-ai-provider"
import { OpenAIProvider } from "@/adapters/openai-provider"
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

function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
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

  it("keeps both channels successful when a mismatched Naver response uses local fallback", async () => {
    const repository = new InMemoryRepository()
    const remoteInstagram = await new LocalAIProvider().generateInstagram({ ...analyzeInput, brief })
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { channel: "naver" | "instagram" }
      const { generationSource: _generationSource, qualityChecks: _qualityChecks, ...data } = remoteInstagram
      if (request.channel === "naver") return Response.json({ channel: "instagram", source: "openai", data })
      return Response.json({ channel: "instagram", source: "openai", data })
    })
    configureStudioServices({ repository, ai: new OpenAIProvider({ fetcher }) })
    const store = useStudioStore()
    store.draft = readyDraft()

    await store.generateAll()

    expect(store.draft.naver).toMatchObject({ status: "success", data: { generationSource: "local-fallback" } })
    expect(store.draft.instagram).toMatchObject({ status: "success", data: { generationSource: "openai" } })
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

  it("returns the visible rewritten section after review and persistence", async () => {
    const repository = new InMemoryRepository()
    configureStudioServices({ repository, ai: new LocalAIProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()

    const result = await store.rewrite({ channel: "naver", section: "intro", instruction: "감성 줄이기" })

    expect(result).toEqual({ section: "intro", text: store.draft.naver.data?.introOptions[0] })
    expect(repository.saveCalls).toBeGreaterThan(1)
  })

  it("preserves a later body edit when a delayed rewrite succeeds", async () => {
    const rewriteStarted = deferred<void>()
    const releaseRewrite = deferred<void>()
    const rewrittenBody = "AI가 새로 쓴 본문입니다. 호흡과 움직임을 차분히 기록했습니다. ".repeat(18)
    const laterUserBody = "사용자가 나중에 직접 편집한 본문입니다. 호흡과 움직임을 꼼꼼히 확인했습니다. ".repeat(18)
    class DelayedRewriteProvider extends LocalAIProvider {
      override async rewriteSection(input: Parameters<LocalAIProvider["rewriteSection"]>[0]) {
        rewriteStarted.resolve()
        await releaseRewrite.promise
        return { section: input.section, text: rewrittenBody }
      }
    }
    const repository = new InMemoryRepository()
    configureStudioServices({ repository, ai: new DelayedRewriteProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()

    const rewrite = store.rewrite({ channel: "naver", section: "body", instruction: "사진 설명 늘리기" })
    await rewriteStarted.promise
    const edit = store.editResult({ channel: "naver", section: "body", text: laterUserBody })
    releaseRewrite.resolve()
    await Promise.all([rewrite, edit])

    expect(store.draft.naver.data?.body).toBe(laterUserBody.trim())
    expect(repository.drafts.get(store.draft.id)?.naver.data?.body).toBe(laterUserBody.trim())
  })

  it("preserves later option and cross-channel edits when a delayed rewrite fails", async () => {
    const rewriteStarted = deferred<void>()
    const releaseRewrite = deferred<void>()
    class DelayedFailureProvider extends LocalAIProvider {
      override async rewriteSection(): Promise<never> {
        rewriteStarted.resolve()
        await releaseRewrite.promise
        throw new Error("재작성 실패")
      }
    }
    const repository = new InMemoryRepository()
    configureStudioServices({ repository, ai: new DelayedFailureProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()
    const selectedIntro = store.draft.naver.data?.introOptions[1]
    const laterCaption = "사용자가 재작성 대기 중 직접 고친 인스타그램 캡션입니다."

    const rewrite = store.rewrite({ channel: "naver", section: "intro", instruction: "감성 줄이기" })
    await rewriteStarted.promise
    const select = store.selectOption({ channel: "naver", kind: "intro", index: 1 })
    const edit = store.editResult({ channel: "instagram", section: "caption", text: laterCaption })
    releaseRewrite.resolve()
    await expect(rewrite).rejects.toThrow("재작성 실패")
    await Promise.all([select, edit])

    expect(store.draft.naver.data?.introOptions[0]).toBe(selectedIntro)
    expect(store.draft.instagram.data?.captionLong).toBe(laterCaption)
    const persisted = repository.drafts.get(store.draft.id)
    expect(persisted?.naver.data?.introOptions[0]).toBe(selectedIntro)
    expect(persisted?.instagram.data?.captionLong).toBe(laterCaption)
  })

  it("continues result mutations after a rejected rewrite", async () => {
    class RejectedRewriteProvider extends LocalAIProvider {
      override async rewriteSection(): Promise<never> {
        throw new Error("재작성 실패")
      }
    }
    const repository = new InMemoryRepository()
    configureStudioServices({ repository, ai: new RejectedRewriteProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()
    const laterCaption = "실패 뒤에도 저장되는 인스타그램 캡션입니다."

    await expect(store.rewrite({ channel: "naver", section: "intro", instruction: "감성 줄이기" }))
      .rejects.toThrow("재작성 실패")
    await store.editResult({ channel: "instagram", section: "caption", text: laterCaption })

    expect(store.draft.instagram.data?.captionLong).toBe(laterCaption)
    expect(repository.drafts.get(store.draft.id)?.instagram.data?.captionLong).toBe(laterCaption)
  })

  it("preserves a regenerated Instagram result after a delayed Naver rewrite fails", async () => {
    const rewriteStarted = deferred<void>()
    const releaseRewrite = deferred<void>()
    const regeneratedCaption = "실패한 네이버 재작성 뒤에도 남아야 하는 새 인스타그램 캡션입니다."
    class DelayedFailureRetryProvider extends LocalAIProvider {
      instagramCalls = 0

      override async generateInstagram(input: Parameters<LocalAIProvider["generateInstagram"]>[0]) {
        const output = await super.generateInstagram(input)
        this.instagramCalls += 1
        return this.instagramCalls === 1 ? output : { ...output, captionLong: regeneratedCaption }
      }

      override async rewriteSection(): Promise<never> {
        rewriteStarted.resolve()
        await releaseRewrite.promise
        throw new Error("재작성 실패")
      }
    }
    const repository = new InMemoryRepository()
    const ai = new DelayedFailureRetryProvider()
    configureStudioServices({ repository, ai })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()
    store.draft.instagram = { status: "error", data: store.draft.instagram.data, error: "인스타그램 실패" }
    await store.saveNow()

    const rewrite = store.rewrite({ channel: "naver", section: "intro", instruction: "감성 줄이기" })
    await rewriteStarted.promise
    const retry = store.retryChannel("instagram")
    const generationCallsWhileRewritePending = ai.instagramCalls
    releaseRewrite.resolve()
    await expect(rewrite).rejects.toThrow("재작성 실패")
    await retry

    expect(generationCallsWhileRewritePending).toBe(1)
    expect(store.draft.instagram).toMatchObject({ status: "success", data: { captionLong: regeneratedCaption } })
    expect(repository.drafts.get(store.draft.id)?.instagram).toMatchObject({
      status: "success",
      data: { captionLong: regeneratedCaption }
    })
  })

  it("runs a queued channel retry after an earlier rewrite rejects", async () => {
    const regeneratedCaption = "거절된 재작성 다음 순서에서 생성된 인스타그램 캡션입니다."
    class RejectedRewriteRetryProvider extends LocalAIProvider {
      instagramCalls = 0

      override async generateInstagram(input: Parameters<LocalAIProvider["generateInstagram"]>[0]) {
        const output = await super.generateInstagram(input)
        this.instagramCalls += 1
        return this.instagramCalls === 1 ? output : { ...output, captionLong: regeneratedCaption }
      }

      override async rewriteSection(): Promise<never> {
        throw new Error("재작성 실패")
      }
    }
    const repository = new InMemoryRepository()
    const ai = new RejectedRewriteRetryProvider()
    configureStudioServices({ repository, ai })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()
    store.draft.instagram = { status: "error", data: store.draft.instagram.data, error: "인스타그램 실패" }
    await store.saveNow()

    const rewrite = store.rewrite({ channel: "naver", section: "intro", instruction: "감성 줄이기" })
    const retry = store.retryChannel("instagram")
    await expect(rewrite).rejects.toThrow("재작성 실패")
    await retry

    expect(store.draft.instagram).toMatchObject({ status: "success", data: { captionLong: regeneratedCaption } })
    expect(repository.drafts.get(store.draft.id)?.instagram).toMatchObject({
      status: "success",
      data: { captionLong: regeneratedCaption }
    })
  })

  it("serializes full result generation behind a pending rewrite", async () => {
    const rewriteStarted = deferred<void>()
    const releaseRewrite = deferred<void>()
    class DelayedFailureGenerationProvider extends LocalAIProvider {
      naverCalls = 0
      instagramCalls = 0

      override async generateNaver(input: Parameters<LocalAIProvider["generateNaver"]>[0]) {
        this.naverCalls += 1
        return super.generateNaver(input)
      }

      override async generateInstagram(input: Parameters<LocalAIProvider["generateInstagram"]>[0]) {
        this.instagramCalls += 1
        return super.generateInstagram(input)
      }

      override async rewriteSection(): Promise<never> {
        rewriteStarted.resolve()
        await releaseRewrite.promise
        throw new Error("재작성 실패")
      }
    }
    const repository = new InMemoryRepository()
    const ai = new DelayedFailureGenerationProvider()
    configureStudioServices({ repository, ai })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()

    const rewrite = store.rewrite({ channel: "naver", section: "intro", instruction: "감성 줄이기" })
    await rewriteStarted.promise
    const generation = store.generateAll()
    const callsWhileRewritePending = [ai.naverCalls, ai.instagramCalls]
    releaseRewrite.resolve()
    await expect(rewrite).rejects.toThrow("재작성 실패")
    await generation

    expect(callsWhileRewritePending).toEqual([1, 1])
    expect(store.draft.naver.status).toBe("success")
    expect(store.draft.instagram.status).toBe("success")
    expect(repository.drafts.get(store.draft.id)).toMatchObject({
      naver: { status: "success" },
      instagram: { status: "success" }
    })
  })

  it("serializes finalization behind a pending result rewrite", async () => {
    const rewriteStarted = deferred<void>()
    const releaseRewrite = deferred<void>()
    const rewrittenTitle = "호흡과 감각을 다시 만나는 수련"
    class DelayedTitleProvider extends LocalAIProvider {
      override async rewriteSection(input: Parameters<LocalAIProvider["rewriteSection"]>[0]) {
        rewriteStarted.resolve()
        await releaseRewrite.promise
        return { section: input.section, text: rewrittenTitle }
      }
    }
    const repository = new InMemoryRepository()
    configureStudioServices({ repository, ai: new DelayedTitleProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()

    const rewrite = store.rewrite({ channel: "naver", section: "title", instruction: "최근 글과 다르게" })
    await rewriteStarted.promise
    const finalize = store.finalize("2026-07-11T02:00:00.000Z")
    const historyEntriesWhileRewritePending = repository.history.size
    releaseRewrite.resolve()
    await Promise.all([rewrite, finalize])

    expect(historyEntriesWhileRewritePending).toBe(0)
    expect(store.draft.title).toBe(rewrittenTitle)
    expect(repository.history.get(store.draft.id)?.title).toBe(rewrittenTitle)
    expect(repository.history.get(store.draft.id)?.naver.data?.titles[0]).toBe(rewrittenTitle)
  })

  it("queues public persistence behind a pending rewrite rollback", async () => {
    const reviewStarted = deferred<void>()
    const releaseReview = deferred<void>()
    class DelayedUnsafeReviewProvider extends LocalAIProvider {
      reviewCalls = 0

      override async review(input: Parameters<LocalAIProvider["review"]>[0]) {
        this.reviewCalls += 1
        if (this.reviewCalls === 1) return super.review(input)
        reviewStarted.resolve()
        await releaseReview.promise
        return {
          medicalClaims: ["새 의료적 단정"],
          repetitions: [],
          privacyWarnings: [],
          passed: false
        }
      }

      override async rewriteSection(input: Parameters<LocalAIProvider["rewriteSection"]>[0]) {
        return { section: input.section, text: "검토가 끝나기 전에는 저장되면 안 되는 새 도입부입니다." }
      }
    }
    const repository = new InMemoryRepository()
    configureStudioServices({ repository, ai: new DelayedUnsafeReviewProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()
    const originalIntro = store.draft.naver.data?.introOptions[0]
    const saveCallsBeforeRewrite = repository.saveCalls

    const rewrite = store.rewrite({ channel: "naver", section: "intro", instruction: "감성 줄이기" })
    await reviewStarted.promise
    const save = store.saveNow()
    const saveCallsWhileReviewPending = repository.saveCalls
    releaseReview.resolve()
    await expect(rewrite).rejects.toThrow("의료적 단정")
    await save

    expect(saveCallsWhileReviewPending).toBe(saveCallsBeforeRewrite)
    expect(store.draft.naver.data?.introOptions[0]).toBe(originalIntro)
    expect(repository.drafts.get(store.draft.id)?.naver.data?.introOptions[0]).toBe(originalIntro)
  })

  it("restores the previous result and review when persistence fails", async () => {
    class FailingRepository extends InMemoryRepository {
      failNextSave = false

      override async saveDraft(...args: Parameters<InMemoryRepository["saveDraft"]>) {
        if (this.failNextSave) {
          this.failNextSave = false
          throw new Error("임시 저장 실패")
        }
        return super.saveDraft(...args)
      }
    }
    const repository = new FailingRepository()
    configureStudioServices({ repository, ai: new LocalAIProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()
    const before = snapshot({ naver: store.draft.naver, review: store.draft.review, updatedAt: store.draft.updatedAt })
    repository.failNextSave = true

    await expect(store.rewrite({ channel: "naver", section: "intro", instruction: "감성 줄이기" }))
      .rejects.toThrow("임시 저장 실패")
    expect({ naver: store.draft.naver, review: store.draft.review, updatedAt: store.draft.updatedAt }).toEqual(before)
  })

  it("keeps the previous result when the rewritten candidate contains an avoided term", async () => {
    class UnsafeProvider extends LocalAIProvider {
      override async rewriteSection(input: Parameters<LocalAIProvider["rewriteSection"]>[0]) {
        return { section: input.section, text: "치료를 보장하는 새 문구" }
      }
    }
    const repository = new InMemoryRepository()
    configureStudioServices({ repository, ai: new UnsafeProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    store.draft.avoid = "치료"
    await store.generateAll()
    const before = snapshot(store.draft.naver)

    await expect(store.rewrite({ channel: "naver", section: "intro", instruction: "감성 줄이기" }))
      .rejects.toThrow("금지 표현")
    expect(store.draft.naver).toEqual(before)
  })

  it("rejects a rewritten candidate for a different section without changing either channel", async () => {
    class MismatchedProvider extends LocalAIProvider {
      override async rewriteSection() {
        return { section: "title", text: "다른 영역에 온 새 문구" }
      }
    }
    configureStudioServices({ repository: new InMemoryRepository(), ai: new MismatchedProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()
    const before = snapshot({ naver: store.draft.naver, instagram: store.draft.instagram })

    await expect(store.rewrite({ channel: "naver", section: "intro", instruction: "감성 줄이기" }))
      .rejects.toThrow("영역")
    expect({ naver: store.draft.naver, instagram: store.draft.instagram }).toEqual(before)
  })

  it("rejects malformed rewritten hashtags without dropping invalid tokens", async () => {
    class MalformedHashtagProvider extends LocalAIProvider {
      override async rewriteSection(input: Parameters<LocalAIProvider["rewriteSection"]>[0]) {
        return { section: input.section, text: "#요가 잘못된태그" }
      }
    }
    configureStudioServices({ repository: new InMemoryRepository(), ai: new MalformedHashtagProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()
    const before = snapshot(store.draft.instagram)

    await expect(store.rewrite({ channel: "instagram", section: "hashtags", instruction: "해시태그 변경" }))
      .rejects.toThrow("해시태그")
    expect(store.draft.instagram).toEqual(before)
  })

  it("returns the normalized hashtag text that is visible and persisted", async () => {
    class WhitespaceHashtagProvider extends LocalAIProvider {
      override async rewriteSection(input: Parameters<LocalAIProvider["rewriteSection"]>[0]) {
        return { section: input.section, text: "#요가\n  #호흡" }
      }
    }
    const repository = new InMemoryRepository()
    configureStudioServices({ repository, ai: new WhitespaceHashtagProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()

    const result = await store.rewrite({ channel: "instagram", section: "hashtags", instruction: "해시태그 변경" })
    const visible = store.draft.instagram.data?.hashtags.join(" ")
    const persisted = repository.drafts.get(store.draft.id)?.instagram.data?.hashtags.join(" ")

    expect(result).toEqual({ section: "hashtags", text: visible })
    expect(persisted).toBe(visible)
  })

  it("rolls back a rewritten candidate that introduces a new medical claim", async () => {
    class MedicalClaimProvider extends LocalAIProvider {
      override async rewriteSection(input: Parameters<LocalAIProvider["rewriteSection"]>[0]) {
        return { section: input.section, text: "이 자세로 통증이 완치됩니다." }
      }
    }
    const repository = new InMemoryRepository()
    configureStudioServices({ repository, ai: new MedicalClaimProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()
    const before = snapshot({ naver: store.draft.naver, review: store.draft.review, updatedAt: store.draft.updatedAt })
    const saveCalls = repository.saveCalls

    await expect(store.rewrite({ channel: "naver", section: "intro", instruction: "감성 줄이기" }))
      .rejects.toThrow("의료")
    expect({ naver: store.draft.naver, review: store.draft.review, updatedAt: store.draft.updatedAt }).toEqual(before)
    expect(repository.saveCalls).toBe(saveCalls)
  })

  it("rejects a second direct medical claim even when review normalizes it to an existing warning", async () => {
    class SecondMedicalClaimProvider extends LocalAIProvider {
      override async rewriteSection(input: Parameters<LocalAIProvider["rewriteSection"]>[0]) {
        return { section: input.section, text: "이 자세로 두통이 완치됩니다." }
      }
    }
    const repository = new InMemoryRepository()
    configureStudioServices({ repository, ai: new SecondMedicalClaimProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()
    await store.editResult({
      channel: "instagram",
      section: "caption",
      text: "이 수련으로 통증이 완치됩니다."
    })
    const before = snapshot({ naver: store.draft.naver, review: store.draft.review, updatedAt: store.draft.updatedAt })
    const saveCalls = repository.saveCalls

    await expect(store.rewrite({ channel: "naver", section: "intro", instruction: "감성 줄이기" }))
      .rejects.toThrow("의료")
    expect({ naver: store.draft.naver, review: store.draft.review, updatedAt: store.draft.updatedAt }).toEqual(before)
    expect(repository.saveCalls).toBe(saveCalls)
  })

  it("rejects an additional direct medical claim in a target that already has one", async () => {
    class AdditionalTargetClaimProvider extends LocalAIProvider {
      override async rewriteSection(input: Parameters<LocalAIProvider["rewriteSection"]>[0]) {
        return {
          section: input.section,
          text: "통증이 완치됩니다. 어깨 불편도 완치됩니다. 오늘 수련 기록입니다."
        }
      }
    }
    const repository = new InMemoryRepository()
    configureStudioServices({ repository, ai: new AdditionalTargetClaimProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()
    await store.editResult({
      channel: "instagram",
      section: "caption",
      text: "통증이 완치됩니다. 오늘 수련 기록입니다."
    })
    const before = snapshot({ instagram: store.draft.instagram, review: store.draft.review, updatedAt: store.draft.updatedAt })
    const saveCalls = repository.saveCalls

    await expect(store.rewrite({ channel: "instagram", section: "caption", instruction: "기록 문구 변경" }))
      .rejects.toThrow("의료")
    expect({ instagram: store.draft.instagram, review: store.draft.review, updatedAt: store.draft.updatedAt }).toEqual(before)
    expect(repository.saveCalls).toBe(saveCalls)
  })

  it("allows safe wording changes that retain exactly one existing target claim", async () => {
    class RetainedTargetClaimProvider extends LocalAIProvider {
      override async rewriteSection(input: Parameters<LocalAIProvider["rewriteSection"]>[0]) {
        return { section: input.section, text: "통증이 완치됩니다. 호흡을 살핀 기록입니다." }
      }
    }
    const repository = new InMemoryRepository()
    configureStudioServices({ repository, ai: new RetainedTargetClaimProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()
    await store.editResult({
      channel: "instagram",
      section: "caption",
      text: "통증이 완치됩니다. 오늘 수련 기록입니다."
    })
    const saveCalls = repository.saveCalls

    const result = await store.rewrite({ channel: "instagram", section: "caption", instruction: "기록 문구 변경" })

    expect(result).toEqual({ section: "caption", text: "통증이 완치됩니다. 호흡을 살핀 기록입니다." })
    expect(store.draft.instagram.data?.captionLong).toBe(result.text)
    expect(repository.saveCalls).toBe(saveCalls + 1)
  })

  it("rejects an additional recovery claim in a target that already has one", async () => {
    class AdditionalRecoveryClaimProvider extends LocalAIProvider {
      override async rewriteSection(input: Parameters<LocalAIProvider["rewriteSection"]>[0]) {
        return {
          section: input.section,
          text: "통증이 나아집니다. 통증이 나아집니다. 오늘 수련 기록입니다."
        }
      }
    }
    const repository = new InMemoryRepository()
    configureStudioServices({ repository, ai: new AdditionalRecoveryClaimProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()
    await store.editResult({
      channel: "instagram",
      section: "caption",
      text: "통증이 나아집니다. 오늘 수련 기록입니다."
    })
    const before = snapshot({ instagram: store.draft.instagram, review: store.draft.review, updatedAt: store.draft.updatedAt })
    const saveCalls = repository.saveCalls

    await expect(store.rewrite({ channel: "instagram", section: "caption", instruction: "기록 문구 변경" }))
      .rejects.toThrow("의료")
    expect({ instagram: store.draft.instagram, review: store.draft.review, updatedAt: store.draft.updatedAt }).toEqual(before)
    expect(repository.saveCalls).toBe(saveCalls)
  })

  it("allows safe wording changes that retain exactly one existing recovery claim", async () => {
    class RetainedRecoveryClaimProvider extends LocalAIProvider {
      override async rewriteSection(input: Parameters<LocalAIProvider["rewriteSection"]>[0]) {
        return { section: input.section, text: "통증이 나아집니다. 호흡을 살핀 기록입니다." }
      }
    }
    const repository = new InMemoryRepository()
    configureStudioServices({ repository, ai: new RetainedRecoveryClaimProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()
    await store.editResult({
      channel: "instagram",
      section: "caption",
      text: "통증이 나아집니다. 오늘 수련 기록입니다."
    })
    const saveCalls = repository.saveCalls

    const result = await store.rewrite({ channel: "instagram", section: "caption", instruction: "기록 문구 변경" })

    expect(result).toEqual({ section: "caption", text: "통증이 나아집니다. 호흡을 살핀 기록입니다." })
    expect(store.draft.instagram.data?.captionLong).toBe(result.text)
    expect(repository.saveCalls).toBe(saveCalls + 1)
  })

  it("restores both channels, review, and timestamp when safety review fails", async () => {
    class ReviewFailureProvider extends LocalAIProvider {
      failNextReview = false

      override async review(input: Parameters<LocalAIProvider["review"]>[0]) {
        if (this.failNextReview) {
          this.failNextReview = false
          throw new Error("안전 검토 실패")
        }
        return super.review(input)
      }
    }
    const repository = new InMemoryRepository()
    const ai = new ReviewFailureProvider()
    configureStudioServices({ repository, ai })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()
    const before = snapshot({
      naver: store.draft.naver,
      instagram: store.draft.instagram,
      review: store.draft.review,
      updatedAt: store.draft.updatedAt
    })
    ai.failNextReview = true

    await expect(store.rewrite({ channel: "naver", section: "intro", instruction: "감성 줄이기" }))
      .rejects.toThrow("안전 검토 실패")
    expect({
      naver: store.draft.naver,
      instagram: store.draft.instagram,
      review: store.draft.review,
      updatedAt: store.draft.updatedAt
    }).toEqual(before)
  })

  it("allows a safe rewrite when an unrelated pre-existing review warning remains", async () => {
    const repository = new InMemoryRepository()
    configureStudioServices({ repository, ai: new LocalAIProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()
    await store.editResult({
      channel: "instagram",
      section: "caption",
      text: "이 수련으로 통증이 완치됩니다."
    })
    const claims = snapshot(store.draft.review?.medicalClaims)
    const saveCalls = repository.saveCalls

    await store.rewrite({ channel: "naver", section: "intro", instruction: "감성 줄이기" })

    expect(store.draft.review?.passed).toBe(false)
    expect(store.draft.review?.medicalClaims).toEqual(claims)
    expect(repository.saveCalls).toBe(saveCalls + 1)
  })

  it("rejects a rewrite that returns the same visible text", async () => {
    const repository = new InMemoryRepository()
    class UnchangedRewriteProvider extends LocalAIProvider {
      override async rewriteSection(input: Parameters<LocalAIProvider["rewriteSection"]>[0]) {
        return { section: input.section, text: input.currentText }
      }
    }
    configureStudioServices({ repository, ai: new UnchangedRewriteProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()

    await expect(store.rewrite({ channel: "naver", section: "intro", instruction: "감성 줄이기" }))
      .rejects.toThrow("다른 문구")
  })

  it("validates direct result edits, recomputes review, and persists before resolving", async () => {
    const repository = new InMemoryRepository()
    configureStudioServices({ repository, ai: new LocalAIProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()
    const originalBody = store.draft.naver.data?.body

    await expect(store.editResult({ channel: "naver", section: "body", text: "너무 짧은 본문" }))
      .rejects.toThrow("500자")
    expect(store.draft.naver.data?.body).toBe(originalBody)

    const saveCalls = repository.saveCalls
    await store.editResult({
      channel: "instagram",
      section: "caption",
      text: "이 수련으로 통증이 완치됩니다."
    })

    expect(store.draft.instagram.data?.captionLong).toContain("완치")
    expect(store.draft.review?.passed).toBe(false)
    expect(store.draft.review?.medicalClaims.length).toBeGreaterThan(0)
    expect(repository.saveCalls).toBe(saveCalls + 1)
  })

  it("includes the directly edited short Instagram caption in the safety review", async () => {
    const repository = new InMemoryRepository()
    configureStudioServices({ repository, ai: new LocalAIProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()

    await store.editResult({
      channel: "instagram",
      section: "short",
      text: "이 자세로 통증이 완치됩니다."
    })

    expect(store.draft.instagram.data?.captionShort).toContain("완치")
    expect(store.draft.review?.passed).toBe(false)
    expect(store.draft.review?.medicalClaims.length).toBeGreaterThan(0)
  })

  it.each(["철학 줄이기", "사진 설명 늘리기"])("keeps the prior Naver body when the %s rewrite is shorter than 500 characters", async (instruction) => {
    const repository = new InMemoryRepository()
    class ShortRewriteProvider extends LocalAIProvider {
      override async rewriteSection(input: Parameters<LocalAIProvider["rewriteSection"]>[0]) {
        return { section: input.section, text: "너무 짧은 본문" }
      }
    }
    configureStudioServices({ repository, ai: new ShortRewriteProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()
    const previousBody = store.draft.naver.data?.body

    await expect(store.rewrite({ channel: "naver", section: "body", instruction })).rejects.toThrow("500자")

    expect(store.draft.naver.data?.body).toBe(previousBody)
  })

  it("refuses generation before explicit brief confirmation", async () => {
    configureStudioServices({ repository: new InMemoryRepository() })
    const store = useStudioStore()
    store.draft = { ...readyDraft(), briefConfirmed: false }

    await expect(store.generateAll()).rejects.toThrow("AI가 이해한 내용을 확인")
  })

  it("prepares selected files and persists only the edited blob", async () => {
    const repository = new InMemoryRepository()
    const editedBlob = new Blob(["metadata-free pixels"], { type: "image/jpeg" })
    configureStudioServices({
      repository,
      prepareImage: vi.fn().mockResolvedValue({
        blob: editedBlob,
        thumbnailUrl: "blob:edited",
        width: 1200,
        height: 900,
        hash: "edited-hash",
        createdAt: "2026-07-11T00:00:00.000Z",
        expiresAt: "2026-07-16T00:00:00.000Z"
      })
    })
    const store = useStudioStore()
    await store.create("2026-07-11T00:00:00.000Z")

    await store.addFiles([new File(["original with exif"], "class.jpg", { type: "image/jpeg" })])

    expect(store.draft?.images[0]).toMatchObject({ status: "ready", hash: "edited-hash", isCover: true })
    expect([...repository.images.values()]).toEqual([editedBlob])
  })

  it("burns masks into edited blobs before confirming the masking step", async () => {
    const repository = new InMemoryRepository()
    const maskedBlob = new Blob(["masked pixels"], { type: "image/jpeg" })
    const applyMasks = vi.fn().mockResolvedValue(maskedBlob)
    configureStudioServices({ repository, applyMasks })
    const store = useStudioStore()
    store.draft = { ...createDraft(), images: studioImages(1) }
    store.draft.images[0].masks = [{ id: "mask-1", style: "blur", x: 0.1, y: 0.1, width: 0.2, height: 0.2, rotation: 0, source: "manual" }]
    repository.images.set(store.draft.images[0].editedBlobId, new Blob(["prepared pixels"]))

    await store.confirmMasks("2026-07-11T00:05:00.000Z")

    expect(applyMasks).toHaveBeenCalledTimes(1)
    expect(store.draft.images[0].maskConfirmedAt).toBe("2026-07-11T00:05:00.000Z")
    expect(store.draft.step).toBe("organize")
    expect(repository.images.get(store.draft.images[0].editedBlobId)).toBe(maskedBlob)
  })

  it("analyzes prepared images once and moves to brief review", async () => {
    const repository = new InMemoryRepository()
    const ai = new LocalAIProvider()
    const analyzeSpy = vi.spyOn(ai, "analyzeImages")
    configureStudioServices({ repository, ai })
    const store = useStudioStore()
    store.draft = { ...readyDraft(), brief: null, briefConfirmed: false, step: "memo" }

    await store.analyze()
    await store.analyze()

    expect(analyzeSpy).toHaveBeenCalledTimes(1)
    expect(store.draft.brief?.bodyFocus).toEqual(["어깨", "흉곽"])
    expect(store.draft.step).toBe("brief")
  })

  it("retries only the failed channel", async () => {
    const repository = new InMemoryRepository()
    const ai = new LocalAIProvider()
    const instagramSpy = vi.spyOn(ai, "generateInstagram")
    const naverSpy = vi.spyOn(ai, "generateNaver")
    configureStudioServices({ repository, ai })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()
    instagramSpy.mockClear()
    naverSpy.mockClear()
    store.draft.instagram = { status: "error", data: null, error: "failed" }

    await store.retryChannel("instagram")

    expect(instagramSpy).toHaveBeenCalledTimes(1)
    expect(naverSpy).not.toHaveBeenCalled()
    expect(store.draft.instagram.status).toBe("success")
  })

  it("returns selectable fallback text when clipboard permission is denied", async () => {
    configureStudioServices({
      repository: new InMemoryRepository(),
      ai: new LocalAIProvider(),
      clipboard: { copy: vi.fn().mockResolvedValue({ ok: false, error: "denied" }) }
    })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()

    const result = await store.copy({ channel: "naver", part: "all" })

    expect(result.ok).toBe(false)
    expect(result.fallback).toContain("호흡")
  })

  it("stores finalized text history without requiring image retention", async () => {
    const repository = new InMemoryRepository()
    configureStudioServices({ repository, ai: new LocalAIProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()

    await store.finalize("2026-07-11T02:00:00.000Z")

    expect(store.draft.finalizedAt).toBe("2026-07-11T02:00:00.000Z")
    expect(repository.history.has(store.draft.id)).toBe(true)
  })

  it("moves the chosen channel option to the copy position", async () => {
    configureStudioServices({ repository: new InMemoryRepository(), ai: new LocalAIProvider() })
    const store = useStudioStore()
    store.draft = readyDraft()
    await store.generateAll()
    const chosen = store.draft.naver.data?.titles[1]

    await store.selectOption({ channel: "naver", kind: "title", index: 1 })

    expect(store.draft.naver.data?.titles[0]).toBe(chosen)
  })
})
