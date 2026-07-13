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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

class ControlledRewriteProvider extends LocalAIProvider {
  rewriteCalls = 0
  private rewriteGate: ReturnType<typeof deferred<void>> | null = null

  holdNextRewrite() {
    const gate = deferred<void>()
    this.rewriteGate = gate
    return () => gate.resolve()
  }

  override async rewriteSection(input: Parameters<LocalAIProvider["rewriteSection"]>[0]) {
    this.rewriteCalls += 1
    const gate = this.rewriteGate
    this.rewriteGate = null
    if (gate) await gate.promise
    return super.rewriteSection(input)
  }
}

class ToggleFailRepository extends InMemoryRepository {
  failNextSave = false

  override async saveDraft(...args: Parameters<InMemoryRepository["saveDraft"]>) {
    if (this.failNextSave) {
      this.failNextSave = false
      throw new Error("임시 저장 실패")
    }
    return super.saveDraft(...args)
  }
}

afterEach(() => resetStudioServices())

describe("studio generation flow", () => {
  it("moves from memo through brief confirmation to two channel results", async () => {
    const repository = new ToggleFailRepository()
    const ai = new ControlledRewriteProvider()
    configureStudioServices({ repository, ai })
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
    await waitFor(() => expect(screen.getByText("두 채널 글을 생성했어요")).toBeTruthy())
    expect(screen.getByRole("tab", { name: "인스타그램" })).toBeTruthy()
    expect(store.draft?.naver.status).toBe("success")
    expect(store.draft?.instagram.status).toBe("success")

    const alternateTitle = store.draft.naver.data?.titles[1] ?? ""
    await fireEvent.click(screen.getByLabelText(alternateTitle))
    await waitFor(() => expect(screen.getByText("제목 옵션을 변경했어요")).toBeTruthy())
    expect((screen.getByLabelText(alternateTitle) as HTMLInputElement).checked).toBe(true)

    const releaseRewrite = ai.holdNextRewrite()
    await fireEvent.click(screen.getByRole("button", { name: "도입부 감성 줄이기" }))

    const activeRewrite = await screen.findByRole("button", { name: "도입부 감성 줄이기 변경 중…" })
    expect((activeRewrite as HTMLButtonElement).disabled).toBe(true)
    expect(activeRewrite.getAttribute("aria-busy")).toBe("true")
    const otherRewrite = screen.getByRole("button", { name: "철학 줄이기" })
    expect((otherRewrite as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(otherRewrite)
    expect(ai.rewriteCalls).toBe(1)

    releaseRewrite()
    await waitFor(() => expect(screen.getByText("도입부의 감성을 줄였어요")).toBeTruthy())
    const persistedIntro = store.draft?.naver.data?.introOptions[0] ?? ""
    expect(screen.getByText("최근 변경 · 도입부")).toBeTruthy()
    expect(screen.getByText(persistedIntro, { selector: ".rewrite-preview p" })).toBeTruthy()

    repository.failNextSave = true
    await fireEvent.click(screen.getByRole("button", { name: "최근 글과 다르게" }))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("임시 저장 실패"))
    expect(screen.queryByText("새 제목을 만들었어요")).toBeNull()
    expect(screen.getByText("최근 변경 · 도입부")).toBeTruthy()
    expect(screen.getByText(persistedIntro, { selector: ".rewrite-preview p" })).toBeTruthy()
    expect((screen.getByRole("button", { name: "최근 글과 다르게" }) as HTMLButtonElement).disabled).toBe(false)

    store.draft.instagram = { status: "error", data: null, error: "다시 생성 필요" }
    repository.failNextSave = true
    await fireEvent.click(screen.getByRole("tab", { name: "인스타그램" }))
    await fireEvent.click(screen.getByRole("button", { name: "인스타그램만 다시 생성" }))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("임시 저장 실패"))
    expect(screen.queryByText("인스타그램 글을 다시 생성했어요")).toBeNull()
  })

  it("shows an error instead of a success toast when both channels fail", async () => {
    class FailedProvider extends LocalAIProvider {
      override async generateNaver(): Promise<never> { throw new Error("네이버 실패") }
      override async generateInstagram(): Promise<never> { throw new Error("인스타그램 실패") }
    }
    const repository = new InMemoryRepository()
    const ai = new FailedProvider()
    configureStudioServices({ repository, ai })
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    const draft = createDraft()
    draft.step = "brief"
    draft.sourceMemo = "호흡과 어깨를 살핀 수련"
    draft.images = studioImages(1).map((image) => ({ ...image, maskConfirmedAt: "2026-07-11T00:05:00.000Z" }))
    draft.brief = await ai.analyzeImages({
      memo: draft.sourceMemo,
      mustInclude: "호흡",
      avoid: "치료",
      writingMode: draft.writingMode,
      naverTone: draft.naverTone,
      instagramTone: draft.instagramTone,
      images: draft.images.map(({ id, isCover, sortOrder }) => ({ id, isCover, sortOrder }))
    })
    draft.briefConfirmed = true
    store.draft = draft
    repository.drafts.set(draft.id, draft)
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/studio/:draftId", component: StudioView }] })
    await router.push(`/studio/${draft.id}`)
    await router.isReady()
    render(StudioView, { global: { plugins: [pinia, router] } })

    await fireEvent.click(screen.getByRole("button", { name: "두 채널 글 생성" }))

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("두 채널 글 생성에 실패했어요"))
    expect(screen.queryByText("생성 가능한 결과를 준비했어요")).toBeNull()
  })
})
