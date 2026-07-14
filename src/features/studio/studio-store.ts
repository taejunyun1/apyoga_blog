import { defineStore } from "pinia"
import { ref, toRaw } from "vue"
import { BrowserClipboard } from "@/adapters/browser-clipboard"
import { DexieStudioRepository, type EditedImageRecord } from "@/adapters/dexie-repository"
import { prepareAnalysisImage, prepareImage, validateImageSelection } from "@/adapters/image-processor"
import { OpenAIProvider } from "@/adapters/openai-provider"
import { countMedicalClaimOccurrences, forbiddenExpressions, isSafePublishableCopy } from "@/domain/content-safety"
import type {
  AIResult,
  AIProvider,
  RewriteInput,
  RewriteNaverTitleAndBodyOutput,
  RewriteOutput,
} from "@/domain/ports"
import { reorderImages, setCoverImage } from "@/domain/rules"
import { createDraft, type DraftUsage, type StudioDraft, type StudioImage, type WorkflowStep } from "@/domain/studio"

export interface StudioRepository {
  saveDraft(draft: StudioDraft, images?: EditedImageRecord[]): Promise<void>
  getDraft(id: string): Promise<StudioDraft | undefined>
  listDrafts(): Promise<StudioDraft[]>
  getImageBlob(id: string): Promise<Blob | undefined>
  cleanupExpired(now: string): Promise<{ drafts: number; images: number }>
  finalize(draft: StudioDraft): Promise<void>
  listHistory(): Promise<StudioDraft[]>
  deleteHistory(id: string): Promise<void>
  clearHistory(): Promise<void>
  deleteDraft(id: string): Promise<void>
  deleteImage(id: string): Promise<void>
}

type LegacyAIProvider = {
  [Method in keyof AIProvider]: AIProvider[Method] extends (...args: infer Args) => Promise<AIResult<infer Data>>
    ? (...args: Args) => Promise<Data>
    : AIProvider[Method]
}

export interface StudioServices {
  repository: StudioRepository
  ai: AIProvider | LegacyAIProvider
  clipboard: { copy(text: string): Promise<{ ok: boolean; error?: string }> }
  prepareImage: typeof prepareImage
  prepareAnalysisImage: typeof prepareAnalysisImage
}

function defaultServices(): StudioServices {
  return {
    repository: new DexieStudioRepository(),
    ai: new OpenAIProvider(),
    clipboard: new BrowserClipboard(),
    prepareImage,
    prepareAnalysisImage
  }
}

let services = defaultServices()

export function configureStudioServices(overrides: Partial<StudioServices>) {
  services = { ...services, ...overrides }
}

export function resetStudioServices() {
  services = defaultServices()
}

function publishableText(draft: StudioDraft): string {
  const naver = draft.naver.data
  const instagram = draft.instagram.data
  return [
    ...(naver?.titles ?? []),
    ...(naver?.introOptions ?? []),
    naver?.body,
    naver?.classInfo,
    ...(naver?.hashtags ?? []),
    ...(instagram?.hookOptions ?? []),
    instagram?.captionLong,
    instagram?.captionShort,
    ...(instagram?.hashtags ?? [])
  ].filter(Boolean).join("\n")
}

export const useStudioStore = defineStore("studio", () => {
  const draft = ref<StudioDraft | null>(null)
  const drafts = ref<StudioDraft[]>([])
  const history = ref<StudioDraft[]>([])
  const projectUsage = ref<DraftUsage>(emptyUsage())
  const saveStatus = ref<"idle" | "saving" | "saved" | "error" | "restored">("idle")
  const lastSavedAt = ref<string | null>(null)
  const busy = ref(false)
  const transientFiles = new Map<string, File>()
  let resultMutationQueue: Promise<void> = Promise.resolve()
  let pendingResultMutations = 0

  function enqueueResultMutation<T>(mutation: () => Promise<T>): Promise<T> {
    pendingResultMutations += 1
    const operation = resultMutationQueue.then(mutation)
    resultMutationQueue = operation.then(
      () => { pendingResultMutations -= 1 },
      () => { pendingResultMutations -= 1 },
    )
    return operation
  }

  async function refreshReview(current: StudioDraft) {
    current.review = await services.ai.review({ text: publishableText(current) })
  }

  async function persistNow(value = draft.value) {
    if (!value) return
    saveStatus.value = "saving"
    try {
      await services.repository.saveDraft(value)
      lastSavedAt.value = new Date().toISOString()
      saveStatus.value = "saved"
    } catch (error) {
      saveStatus.value = "error"
      throw error
    }
  }

  function saveNow() {
    return enqueueResultMutation(persistNow)
  }

  async function create(now?: string) {
    draft.value = createDraft(now)
    await saveNow()
    return draft.value
  }

  async function loadHome(now = new Date().toISOString()) {
    await services.repository.cleanupExpired(now)
    drafts.value = (await services.repository.listDrafts()).map(normalizeDraftUsage)
    history.value = (await services.repository.listHistory()).map(normalizeDraftUsage)
  }

  async function loadUsageSummary() {
    let response: Response
    try {
      response = await fetch("/api/usage", { credentials: "same-origin" })
    } catch {
      throw new Error("AI 사용량을 불러오지 못했어요.")
    }
    if (!response.ok) throw new Error("AI 사용량을 불러오지 못했어요.")

    let summary: unknown
    try {
      summary = await response.json()
    } catch {
      throw new Error("AI 사용량을 불러오지 못했어요.")
    }
    if (!isDraftUsage(summary)) throw new Error("AI 사용량을 불러오지 못했어요.")
    projectUsage.value = summary
    return summary
  }

  async function deleteHistory(id: string) {
    await services.repository.deleteHistory(id)
    history.value = history.value.filter((item) => item.id !== id)
  }

  async function clearHistory() {
    await services.repository.clearHistory()
    history.value = []
  }

  async function deleteDraft(id: string) {
    await services.repository.deleteDraft(id)
    drafts.value = drafts.value.filter((item) => item.id !== id)
  }

  async function load(id: string) {
    const restored = await services.repository.getDraft(id)
    if (!restored) throw new Error("작성 중인 글을 찾지 못했어요.")
    normalizeDraftUsage(restored)
    if ((restored as unknown as { step: string }).step === "mask") restored.step = "organize"
    for (const image of restored.images) {
      const blob = await services.repository.getImageBlob(image.editedBlobId)
      if (blob && typeof URL.createObjectURL === "function") image.thumbnailUrl = URL.createObjectURL(blob)
    }
    draft.value = restored
    saveStatus.value = "restored"
    return restored
  }

  async function addFiles(files: File[]) {
    if (!draft.value) throw new Error("먼저 새 글을 만들어 주세요.")
    validateImageSelection(files, draft.value.images.length)
    const newImages: StudioImage[] = files.map((file, index) => {
      const id = crypto.randomUUID()
      transientFiles.set(id, file)
      return {
        id,
        name: file.name,
        editedBlobId: crypto.randomUUID(),
        thumbnailUrl: "",
        width: 0,
        height: 0,
        hash: "",
        sortOrder: draft.value!.images.length + index,
        isCover: false,
        status: "processing",
        error: null,
        createdAt: new Date().toISOString(),
        expiresAt: new Date().toISOString()
      }
    })
    draft.value.images.push(...newImages)

    await Promise.all(newImages.map(async (image) => {
      const file = transientFiles.get(image.id)
      if (!file || !draft.value) return
      const liveImage = draft.value.images.find((item) => item.id === image.id)
      if (!liveImage) return
      try {
        const prepared = await services.prepareImage(file)
        Object.assign(liveImage, {
          thumbnailUrl: prepared.thumbnailUrl,
          width: prepared.width,
          height: prepared.height,
          hash: prepared.hash,
          status: "ready" as const,
          error: null,
          createdAt: prepared.createdAt,
          expiresAt: prepared.expiresAt
        })
        if (!draft.value.images.some((item) => item.isCover && item.status === "ready")) liveImage.isCover = true
        await services.repository.saveDraft(draft.value, [{
          id: liveImage.editedBlobId,
          draftId: draft.value.id,
          blob: prepared.blob,
          expiresAt: prepared.expiresAt
        }])
      } catch (error) {
        liveImage.status = "error"
        liveImage.error = errorMessage(error)
      }
    }))
    draft.value.updatedAt = new Date().toISOString()
    await saveNow()
  }

  async function completePhotoSelection(now = new Date().toISOString()) {
    if (!draft.value || !draft.value.images.some((image) => image.status === "ready")) {
      throw new Error("처리 완료된 사진을 한 장 이상 준비해 주세요.")
    }
    draft.value.step = "organize"
    draft.value.updatedAt = now
    await saveNow()
  }

  async function retryImage(imageId: string) {
    const image = draft.value?.images.find((item) => item.id === imageId)
    const file = transientFiles.get(imageId)
    if (!image || !file) throw new Error("원본 선택 정보가 없어 사진을 다시 선택해 주세요.")
    image.status = "processing"
    image.error = null
    const prepared = await services.prepareImage(file)
    Object.assign(image, {
      thumbnailUrl: prepared.thumbnailUrl,
      width: prepared.width,
      height: prepared.height,
      hash: prepared.hash,
      createdAt: prepared.createdAt,
      expiresAt: prepared.expiresAt,
      status: "ready" as const,
      error: null
    })
    await services.repository.saveDraft(draft.value!, [{ id: image.editedBlobId, draftId: draft.value!.id, blob: prepared.blob, expiresAt: prepared.expiresAt }])
    await saveNow()
  }

  function updateMemo(value: { memo: string; mustInclude: string; avoid: string; writingMode: StudioDraft["writingMode"]; naverTone: StudioDraft["naverTone"]; instagramTone: StudioDraft["instagramTone"] }) {
    if (!draft.value) return
    draft.value.sourceMemo = value.memo
    draft.value.mustInclude = value.mustInclude
    draft.value.avoid = value.avoid
    draft.value.writingMode = value.writingMode
    draft.value.naverTone = value.naverTone
    draft.value.instagramTone = value.instagramTone
    draft.value.brief = null
    draft.value.briefConfirmed = false
  }

  async function analyze() {
    if (!draft.value) throw new Error("작성 중인 글이 없어요.")
    if (!draft.value.sourceMemo.trim()) throw new Error("오늘의 수련 메모를 입력해 주세요.")
    if (draft.value.brief) {
      draft.value.step = "brief"
      return draft.value.brief
    }
    const current = draft.value
    const readyImages = [...current.images]
      .filter((image) => image.status === "ready")
      .sort((a, b) => a.sortOrder - b.sortOrder)
    if (!readyImages.length) throw new Error("분석할 사진을 한 장 이상 준비해 주세요.")
    busy.value = true
    try {
      const images = await Promise.all(readyImages.map(async ({ id, editedBlobId, isCover, sortOrder }) => {
        const blob = await services.repository.getImageBlob(editedBlobId)
        if (!blob) throw new Error("사진 분석용 이미지를 찾지 못했어요. 사진을 다시 선택해 주세요.")
        return { id, isCover, sortOrder, dataUrl: await services.prepareAnalysisImage(blob) }
      }))
      const result = normalizeAIResult(await services.ai.analyzeImages({
        draftId: current.id,
        memo: current.sourceMemo,
        mustInclude: current.mustInclude,
        avoid: current.avoid,
        writingMode: current.writingMode,
        naverTone: current.naverTone,
        instagramTone: current.instagramTone,
        images
      }))
      current.brief = result.data
      current.briefConfirmed = false
      current.step = "brief"
      current.usage = addUsage(current.usage, result.usage)
      current.updatedAt = new Date().toISOString()
      await saveNow()
      return current.brief
    } finally {
      busy.value = false
    }
  }

  function updateBrief(value: NonNullable<StudioDraft["brief"]>) {
    if (!draft.value) return
    draft.value.brief = JSON.parse(JSON.stringify(value)) as NonNullable<StudioDraft["brief"]>
    draft.value.briefConfirmed = false
  }

  function confirmBrief() {
    if (draft.value?.brief) draft.value.briefConfirmed = true
  }

  function reorder(from: number, to: number) {
    if (draft.value) draft.value.images = reorderImages(draft.value.images, from, to)
  }

  function chooseCover(imageId: string) {
    if (draft.value) draft.value.images = setCoverImage(draft.value.images, imageId)
  }

  async function removeImage(imageId: string) {
    if (!draft.value) return
    const image = draft.value.images.find((item) => item.id === imageId)
    if (image?.thumbnailUrl.startsWith("blob:")) URL.revokeObjectURL(image.thumbnailUrl)
    draft.value.images = draft.value.images.filter((item) => item.id !== imageId).map((item, sortOrder) => ({ ...item, sortOrder }))
    if (image?.isCover && draft.value.images[0]) draft.value.images[0].isCover = true
    transientFiles.delete(imageId)
    if (image) await services.repository.deleteImage(image.editedBlobId)
    await saveNow()
  }

  function generateAll() {
    return enqueueResultMutation(async () => {
      const current = draft.value
      const brief = current?.brief
      if (!current || !brief || !current.briefConfirmed) {
        throw new Error("AI가 이해한 내용을 확인한 뒤 생성해 주세요.")
      }

      const input = {
        draftId: current.id,
        memo: current.sourceMemo,
        mustInclude: current.mustInclude,
        avoid: current.avoid,
        writingMode: current.writingMode,
        naverTone: current.naverTone,
        instagramTone: current.instagramTone,
        images: current.images.map(({ id, isCover, sortOrder }) => ({ id, isCover, sortOrder })),
        brief
      }
      current.step = "generating"
      current.naver = { status: "loading", data: current.naver.data, error: null }
      current.instagram = { status: "loading", data: current.instagram.data, error: null }

      const [naver, instagram] = await Promise.allSettled([
        services.ai.generateNaver(input),
        services.ai.generateInstagram(input)
      ])

      if (naver.status === "fulfilled") {
        const result = normalizeAIResult(naver.value)
        current.naver = { status: "success", data: result.data, error: null }
        current.usage = addUsage(current.usage, result.usage)
      } else {
        current.naver = { status: "error", data: current.naver.data, error: errorMessage(naver.reason) }
      }
      if (instagram.status === "fulfilled") {
        const result = normalizeAIResult(instagram.value)
        current.instagram = { status: "success", data: result.data, error: null }
        current.usage = addUsage(current.usage, result.usage)
      } else {
        current.instagram = { status: "error", data: current.instagram.data, error: errorMessage(instagram.reason) }
      }
      current.step = "results"
      await refreshReview(current)
      current.updatedAt = new Date().toISOString()
      await persistNow()
    })
  }

  function retryChannel(channel: "naver" | "instagram") {
    return enqueueResultMutation(async () => {
      if (!draft.value?.brief) throw new Error("공통 콘텐츠 브리프가 없어요.")
      const current = draft.value
      const input = channelInput(current)
      if (channel === "naver") current.naver = { status: "loading", data: current.naver.data, error: null }
      else current.instagram = { status: "loading", data: current.instagram.data, error: null }
      try {
        if (channel === "naver") {
          const result = normalizeAIResult(await services.ai.generateNaver(input))
          current.naver = { status: "success", data: result.data, error: null }
          current.usage = addUsage(current.usage, result.usage)
        } else {
          const result = normalizeAIResult(await services.ai.generateInstagram(input))
          current.instagram = { status: "success", data: result.data, error: null }
          current.usage = addUsage(current.usage, result.usage)
        }
      } catch (error) {
        if (channel === "naver") current.naver = { status: "error", data: current.naver.data, error: errorMessage(error) }
        else current.instagram = { status: "error", data: current.instagram.data, error: errorMessage(error) }
      }
      await refreshReview(current)
      await persistNow()
    })
  }

  function rewrite(request: { channel: "naver" | "instagram"; section: string; instruction: string }) {
    return enqueueResultMutation(async () => {
      if (!draft.value) throw new Error("작성 중인 글이 없어요.")
      const current = draft.value
      const before = {
        naver: snapshotValue(current.naver),
        instagram: snapshotValue(current.instagram),
        review: current.review ? snapshotValue(current.review) : null,
        usage: snapshotValue(current.usage),
        updatedAt: current.updatedAt
      }

      try {
        if (request.channel === "naver" && request.section === "titleAndBody") {
          const output = current.naver.data
          if (!output) throw new Error("먼저 네이버 콘텐츠를 생성해 주세요.")
          const currentTitle = output.titles[0] ?? ""
          const currentBody = output.body
          const result = normalizeAIResult(await services.ai.rewriteNaverTitleAndBody({
            draftId: current.id,
            currentTitle,
            currentBody,
            instruction: request.instruction,
            memo: current.sourceMemo,
            photoContext: rewritePhotoContext(current),
            avoid: current.avoid,
            tone: current.naverTone,
          }))
          const rewritten = result.data
          validateTitleAndBodyCandidate(rewritten, currentTitle, currentBody, current.avoid)
          output.titles[0] = rewritten.title.trim()
          output.body = rewritten.body.trim()
          await refreshReview(current)
          assertNoNewMedicalClaims(before.review, current.review)
          current.usage = addUsage(current.usage, result.usage)
          current.updatedAt = new Date().toISOString()
          await persistNow()
          return { section: "titleAndBody" as const, title: output.titles[0], body: output.body, text: output.body }
        }

        const currentText = sectionText(current, request.channel, request.section)
        const input: RewriteInput = {
          ...request,
          draftId: current.id,
          currentText,
          memo: current.sourceMemo,
          avoid: current.avoid,
          tone: request.channel === "naver" ? current.naverTone : current.instagramTone
        }
        const result = normalizeAIResult(await services.ai.rewriteSection(input))
        const rewritten = result.data
        validateRewriteCandidate(rewritten, currentText, request, current.avoid)
        applyRewrite(current, request.channel, request.section, rewritten.text)
        const visibleRewrite: RewriteOutput = {
          section: rewritten.section,
          text: sectionText(current, request.channel, request.section)
        }
        await refreshReview(current)

        assertNoNewMedicalClaims(before.review, current.review)
        current.usage = addUsage(current.usage, result.usage)

        current.updatedAt = new Date().toISOString()
        await persistNow()
        return visibleRewrite
      } catch (error) {
        current.naver = before.naver
        current.instagram = before.instagram
        current.review = before.review
        current.usage = before.usage
        current.updatedAt = before.updatedAt
        throw error
      }
    })
  }

  function editResult(request: { channel: "naver" | "instagram"; section: "body" | "caption" | "short"; text: string }) {
    return enqueueResultMutation(async () => {
      if (!draft.value) throw new Error("작성 중인 글이 없어요.")
      const text = request.text.trim()
      if (!text) throw new Error("수정할 문구를 입력해 주세요.")
      if (request.channel === "naver") {
        if (request.section !== "body") throw new Error("수정할 네이버 영역을 확인해 주세요.")
        if (text.length < 500) throw new Error("네이버 본문은 500자 이상이어야 해요. 기존 본문을 유지합니다.")
        const result = draft.value.naver.data
        if (!result) throw new Error("먼저 네이버 콘텐츠를 생성해 주세요.")
        result.body = text
      } else {
        const result = draft.value.instagram.data
        if (!result) throw new Error("먼저 인스타그램 콘텐츠를 생성해 주세요.")
        if (request.section === "caption") result.captionLong = text
        else if (request.section === "short") result.captionShort = text
        else throw new Error("수정할 인스타그램 영역을 확인해 주세요.")
      }

      await refreshReview(draft.value)
      draft.value.updatedAt = new Date().toISOString()
      await persistNow()
    })
  }

  async function copy(request: { channel: "naver" | "instagram"; part: "title" | "body" | "hashtags" | "all" }) {
    if (!draft.value) throw new Error("복사할 글이 없어요.")
    const text = copyText(draft.value, request.channel, request.part)
    const result = await services.clipboard.copy(text)
    return { ...result, fallback: result.ok ? null : text }
  }

  function selectOption(request: { channel: "naver" | "instagram"; kind: "title" | "intro" | "hook"; index: number }) {
    return enqueueResultMutation(async () => {
      if (!draft.value) return
      let options: string[] | undefined
      if (request.channel === "naver" && request.kind === "title") options = draft.value.naver.data?.titles
      else if (request.channel === "naver" && request.kind === "intro") options = draft.value.naver.data?.introOptions
      else if (request.channel === "instagram" && request.kind === "hook") options = draft.value.instagram.data?.hookOptions
      if (!options?.[request.index]) return
      const [selected] = options.splice(request.index, 1)
      options.unshift(selected)
      await persistNow()
    })
  }

  function finalize(now = new Date().toISOString()) {
    return enqueueResultMutation(async () => {
      if (!draft.value) throw new Error("완료할 글이 없어요.")
      draft.value.finalizedAt = now
      draft.value.updatedAt = now
      draft.value.title = draft.value.naver.data?.titles[0] ?? draft.value.instagram.data?.hookOptions[0] ?? "완료한 콘텐츠"
      await services.repository.finalize(draft.value)
      await persistNow()
      history.value = await services.repository.listHistory()
    })
  }

  function goToCompletedStep(target: WorkflowStep) {
    const current = draft.value
    if (target === "generating" || current?.step === "generating") {
      return Promise.reject(new Error("생성 중 단계로는 이동할 수 없어요."))
    }
    if (!current || busy.value || pendingResultMutations > 0) {
      return Promise.reject(new Error("완료한 이전 단계로만 이동할 수 있어요."))
    }
    return enqueueResultMutation(async () => {
      if (!draft.value || !canGoToPriorStep(draft.value.step, target)) {
        throw new Error("완료한 이전 단계로만 이동할 수 있어요.")
      }
      const next = snapshotValue(draft.value)
      next.step = target
      next.updatedAt = new Date().toISOString()
      await persistNow(next)
      draft.value = next
    })
  }

  async function discard() {
    if (!draft.value) return
    await services.repository.deleteDraft(draft.value.id)
    draft.value = null
  }

  return {
    draft, drafts, history, projectUsage, saveStatus, lastSavedAt, busy,
    create, loadHome, loadUsageSummary, deleteHistory, clearHistory, deleteDraft, load, saveNow, addFiles, completePhotoSelection, retryImage,
    reorder, chooseCover, removeImage, updateMemo, analyze, updateBrief, confirmBrief,
    generateAll, retryChannel, rewrite, editResult, selectOption, copy, finalize, goToCompletedStep, discard
  }
})

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "생성 중 알 수 없는 오류가 발생했어요."
}

function emptyUsage(): DraftUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedKrw: 0,
    requestCount: 0,
  }
}

function isDraftUsage(value: unknown): value is DraftUsage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const usage = value as Record<string, unknown>
  return [
    usage.inputTokens,
    usage.cachedInputTokens,
    usage.outputTokens,
    usage.totalTokens,
    usage.estimatedKrw,
    usage.requestCount,
  ].every((entry) => typeof entry === "number" && Number.isSafeInteger(entry) && entry >= 0)
    && (usage.cachedInputTokens as number) <= (usage.inputTokens as number)
    && usage.totalTokens === (usage.inputTokens as number) + (usage.outputTokens as number)
}

function normalizeDraftUsage(draft: StudioDraft): StudioDraft {
  if (!isDraftUsage((draft as { usage?: unknown }).usage)) draft.usage = emptyUsage()
  return draft
}

function addUsage(current: DraftUsage, next: DraftUsage | null): DraftUsage {
  if (!next) return current
  const inputTokens = current.inputTokens + next.inputTokens
  const outputTokens = current.outputTokens + next.outputTokens
  return {
    inputTokens,
    cachedInputTokens: current.cachedInputTokens + next.cachedInputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedKrw: current.estimatedKrw + next.estimatedKrw,
    requestCount: current.requestCount + next.requestCount,
  }
}

function normalizeAIResult<T>(value: AIResult<T> | T): AIResult<T> {
  const candidate = value as unknown
  if (typeof candidate === "object" && candidate !== null
    && Object.hasOwn(candidate, "data") && Object.hasOwn(candidate, "usage")) {
    return candidate as AIResult<T>
  }
  return { data: candidate as T, usage: null }
}

const stableSteps: readonly WorkflowStep[] = ["photos", "organize", "memo", "brief", "results"]

function canGoToPriorStep(current: WorkflowStep, target: WorkflowStep): boolean {
  if (current === "generating" || target === "generating") return false
  return stableSteps.indexOf(target) >= 0 && stableSteps.indexOf(target) < stableSteps.indexOf(current)
}

function snapshotValue<T>(value: T): T {
  return structuredClone(deepToRaw(value))
}

function deepToRaw<T>(value: T): T {
  const raw = toRaw(value)
  if (Array.isArray(raw)) return raw.map((entry) => deepToRaw(entry)) as T
  if (raw !== null && typeof raw === "object") {
    return Object.fromEntries(
      Object.entries(raw).map(([key, entry]) => [key, deepToRaw(entry)])
    ) as T
  }
  return raw
}

function channelInput(current: StudioDraft) {
  if (!current.brief) throw new Error("공통 콘텐츠 브리프가 없어요.")
  return {
    draftId: current.id,
    memo: current.sourceMemo,
    mustInclude: current.mustInclude,
    avoid: current.avoid,
    writingMode: current.writingMode,
    naverTone: current.naverTone,
    instagramTone: current.instagramTone,
    images: current.images.map(({ id, isCover, sortOrder }) => ({ id, isCover, sortOrder })),
    brief: current.brief
  }
}

function rewritePhotoContext(draft: StudioDraft): string {
  const brief = draft.brief
  if (!brief) throw new Error("공통 콘텐츠 브리프가 없어요.")
  return [
    `전체 분위기: ${brief.overallMood}`,
    `본문 초점: ${brief.bodyFocus.join(", ")}`,
    ...brief.imageDescriptions.map((image) => `사진 설명: ${image.description}`),
    `메모 요약: ${brief.userMemoSummary}`,
  ].join("\n")
}

function validateTitleAndBodyCandidate(
  rewritten: RewriteNaverTitleAndBodyOutput,
  currentTitle: string,
  currentBody: string,
  avoid: string,
): void {
  const title = rewritten.title.trim()
  const body = rewritten.body.trim()
  if (!title || title === currentTitle.trim()) {
    throw new Error("이전과 다른 제목을 만들지 못했어요. 다시 시도해 주세요.")
  }
  if (!body || body === currentBody.trim()) {
    throw new Error("이전과 다른 본문을 만들지 못했어요. 다시 시도해 주세요.")
  }
  if (body.length < 500) {
    throw new Error("네이버 본문은 500자 이상이어야 해요. 기존 제목과 본문을 유지합니다.")
  }
  if (!isSafePublishableCopy([title, body], avoid)) {
    throw new Error("재작성 문구에 금지 표현 또는 의료적 단정이 포함되어 기존 제목과 본문을 유지합니다.")
  }
  if (/(?:사진|이미지)\s*(?:속|에는|은|는|에서|에|을|를|으로는?)/u.test(body)) {
    throw new Error("사진 장면을 나열하지 않고 감성적인 발행 문장으로 작성해 주세요.")
  }
}

function assertNoNewMedicalClaims(
  previousReview: StudioDraft["review"],
  currentReview: StudioDraft["review"],
): void {
  const previousMedicalClaims = new Set(previousReview?.medicalClaims ?? [])
  if (currentReview?.medicalClaims.some((claim) => !previousMedicalClaims.has(claim))) {
    throw new Error("새 재작성 문구에 의료적 단정이 포함되어 기존 문구를 유지합니다.")
  }
}

function copyText(draft: StudioDraft, channel: "naver" | "instagram", part: "title" | "body" | "hashtags" | "all"): string {
  if (channel === "naver") {
    const output = draft.naver.data
    if (!output) throw new Error("네이버 결과가 없어요.")
    const title = output.titles[0] ?? ""
    const hashtags = output.hashtags.join(" ")
    if (part === "title") return title
    if (part === "body") return output.body
    if (part === "hashtags") return hashtags
    return [title, output.body, hashtags].filter(Boolean).join("\n\n")
  }
  const output = draft.instagram.data
  if (!output) throw new Error("인스타그램 결과가 없어요.")
  const hook = output.hookOptions[0] ?? ""
  const hashtags = output.hashtags.join(" ")
  if (part === "title") return hook
  if (part === "body") return output.captionLong
  if (part === "hashtags") return hashtags
  return [hook, output.captionLong, hashtags].filter(Boolean).join("\n\n")
}

function sectionText(draft: StudioDraft, channel: "naver" | "instagram", section: string): string {
  if (channel === "naver") {
    const naver = draft.naver.data
    if (!naver) throw new Error("먼저 네이버 콘텐츠를 생성해 주세요.")
    if (section === "title") return naver.titles[0] ?? ""
    if (section === "intro") return naver.introOptions[0] ?? ""
    if (section === "body") return naver.body
    throw new Error("수정할 네이버 영역을 확인해 주세요.")
  }
  const instagram = draft.instagram.data
  if (!instagram) throw new Error("먼저 인스타그램 콘텐츠를 생성해 주세요.")
  if (section === "hook") return instagram.hookOptions[0] ?? ""
  if (section === "caption") return instagram.captionLong
  if (section === "short") return instagram.captionShort
  if (section === "hashtags") return instagram.hashtags.join(" ")
  throw new Error("수정할 인스타그램 영역을 확인해 주세요.")
}

function validateRewriteCandidate(
  rewritten: RewriteOutput,
  currentText: string,
  request: { channel: "naver" | "instagram"; section: string },
  avoid: string
): void {
  if (rewritten.section !== request.section) {
    throw new Error("AI가 요청과 다른 영역을 재작성해 기존 문구를 유지합니다.")
  }
  if (typeof rewritten.text !== "string" || !rewritten.text.trim()) {
    throw new Error("재작성할 문구를 만들지 못했어요. 다시 시도해 주세요.")
  }
  if (rewritten.text.trim() === currentText.trim()) {
    throw new Error("이전과 다른 문구를 만들지 못했어요. 다시 시도해 주세요.")
  }
  if (countMedicalClaimOccurrences(rewritten.text) > countMedicalClaimOccurrences(currentText)) {
    throw new Error("새 재작성 문구에 의료적 단정이 포함되어 기존 문구를 유지합니다.")
  }
  if (request.channel === "naver" && request.section === "body" && rewritten.text.trim().length < 500) {
    throw new Error("네이버 본문은 500자 이상이어야 해요. 기존 본문을 유지합니다.")
  }
  if (request.section === "hashtags") {
    const hashtags = rewritten.text.trim().split(/\s+/)
    if (hashtags.some((value) => !value.startsWith("#") || value.length < 2)) {
      throw new Error("모든 해시태그는 #으로 시작해야 해요. 기존 해시태그를 유지합니다.")
    }
  }
  if (forbiddenExpressions(avoid).some((expression) => rewritten.text.includes(expression))) {
    throw new Error("재작성 문구에 금지 표현이 포함되어 기존 문구를 유지합니다.")
  }
}

function applyRewrite(
  draft: StudioDraft,
  channel: "naver" | "instagram",
  section: string,
  text: string
): void {
  if (channel === "naver") {
    const result = draft.naver.data
    if (!result) throw new Error("먼저 네이버 콘텐츠를 생성해 주세요.")
    if (section === "title") result.titles[0] = text
    else if (section === "intro") result.introOptions[0] = text
    else if (section === "body") result.body = text
    else throw new Error("수정할 네이버 영역을 확인해 주세요.")
    return
  }

  const result = draft.instagram.data
  if (!result) throw new Error("먼저 인스타그램 콘텐츠를 생성해 주세요.")
  if (section === "hook") result.hookOptions[0] = text
  else if (section === "caption") result.captionLong = text
  else if (section === "short") result.captionShort = text
  else if (section === "hashtags") result.hashtags = text.trim().split(/\s+/)
  else throw new Error("수정할 인스타그램 영역을 확인해 주세요.")
}
