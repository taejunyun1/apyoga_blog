import { defineStore } from "pinia"
import { ref } from "vue"
import { BrowserClipboard } from "@/adapters/browser-clipboard"
import { DexieStudioRepository, type EditedImageRecord } from "@/adapters/dexie-repository"
import { applyMasksToBlob, prepareImage, validateImageSelection } from "@/adapters/image-processor"
import { LocalAIProvider } from "@/adapters/local-ai-provider"
import { MediaPipeFaceDetector, type DetectedFace } from "@/adapters/mediapipe-face-detector"
import type { AIProvider } from "@/domain/ports"
import { reorderImages, setCoverImage } from "@/domain/rules"
import { createDraft, type FaceMask, type StudioDraft, type StudioImage } from "@/domain/studio"
import type { RewriteInput } from "@/domain/ports"

export interface StudioRepository {
  saveDraft(draft: StudioDraft, images?: EditedImageRecord[]): Promise<void>
  getDraft(id: string): Promise<StudioDraft | undefined>
  listDrafts(): Promise<StudioDraft[]>
  getImageBlob(id: string): Promise<Blob | undefined>
  cleanupExpired(now: string): Promise<{ drafts: number; images: number }>
  finalize(draft: StudioDraft): Promise<void>
  listHistory(): Promise<StudioDraft[]>
  deleteDraft(id: string): Promise<void>
  deleteImage(id: string): Promise<void>
}

export interface StudioServices {
  repository: StudioRepository
  ai: AIProvider
  clipboard: { copy(text: string): Promise<{ ok: boolean; error?: string }> }
  prepareImage: typeof prepareImage
  applyMasks: typeof applyMasksToBlob
  faceDetector: { detect(source: HTMLImageElement): Promise<DetectedFace[]>; lastDiagnostic: string | null }
}

function defaultServices(): StudioServices {
  return {
    repository: new DexieStudioRepository(),
    ai: new LocalAIProvider(),
    clipboard: new BrowserClipboard(),
    prepareImage,
    applyMasks: applyMasksToBlob,
    faceDetector: new MediaPipeFaceDetector()
  }
}

let services = defaultServices()

export function configureStudioServices(overrides: Partial<StudioServices>) {
  services = { ...services, ...overrides }
}

export function resetStudioServices() {
  services = defaultServices()
}

export const useStudioStore = defineStore("studio", () => {
  const draft = ref<StudioDraft | null>(null)
  const drafts = ref<StudioDraft[]>([])
  const history = ref<StudioDraft[]>([])
  const saveStatus = ref<"idle" | "saving" | "saved" | "error" | "restored">("idle")
  const lastSavedAt = ref<string | null>(null)
  const busy = ref(false)
  const faceDetectionMessage = ref<string | null>(null)
  const transientFiles = new Map<string, File>()

  async function saveNow() {
    if (!draft.value) return
    saveStatus.value = "saving"
    try {
      await services.repository.saveDraft(draft.value)
      lastSavedAt.value = new Date().toISOString()
      saveStatus.value = "saved"
    } catch (error) {
      saveStatus.value = "error"
      throw error
    }
  }

  async function create(now?: string) {
    draft.value = createDraft(now)
    await saveNow()
    return draft.value
  }

  async function loadHome(now = new Date().toISOString()) {
    await services.repository.cleanupExpired(now)
    drafts.value = await services.repository.listDrafts()
    history.value = await services.repository.listHistory()
  }

  async function load(id: string) {
    const restored = await services.repository.getDraft(id)
    if (!restored) throw new Error("작성 중인 글을 찾지 못했어요.")
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
        faceCount: 0,
        masks: [],
        maskConfirmedAt: null,
        createdAt: new Date().toISOString(),
        expiresAt: new Date().toISOString()
      }
    })
    draft.value.images.push(...newImages)

    await Promise.all(newImages.map(async (image) => {
      const file = transientFiles.get(image.id)
      if (!file || !draft.value) return
      try {
        const prepared = await services.prepareImage(file)
        Object.assign(image, {
          thumbnailUrl: prepared.thumbnailUrl,
          width: prepared.width,
          height: prepared.height,
          hash: prepared.hash,
          status: "ready" as const,
          error: null,
          createdAt: prepared.createdAt,
          expiresAt: prepared.expiresAt
        })
        if (!draft.value.images.some((item) => item.isCover && item.status === "ready")) image.isCover = true
        await services.repository.saveDraft(draft.value, [{
          id: image.editedBlobId,
          draftId: draft.value.id,
          blob: prepared.blob,
          expiresAt: prepared.expiresAt
        }])
      } catch (error) {
        image.status = "error"
        image.error = errorMessage(error)
      }
    }))
    draft.value.updatedAt = new Date().toISOString()
    await saveNow()
  }

  async function beginMasking() {
    if (!draft.value || !draft.value.images.some((image) => image.status === "ready")) {
      throw new Error("처리 완료된 사진을 한 장 이상 준비해 주세요.")
    }
    busy.value = true
    faceDetectionMessage.value = null
    draft.value.step = "mask"
    try {
      for (const studioImage of draft.value.images.filter((image) => image.status === "ready" && image.masks.length === 0)) {
        const element = new Image()
        element.src = studioImage.thumbnailUrl
        if (typeof element.decode === "function") await element.decode().catch(() => undefined)
        const detected = await services.faceDetector.detect(element)
        studioImage.faceCount = detected.length
        studioImage.masks = detected.map((face) => ({
          id: crypto.randomUUID(),
          style: "blur",
          x: face.x,
          y: face.y,
          width: face.width,
          height: face.height,
          rotation: 0,
          source: "detected"
        }))
      }
      const detectedCount = draft.value.images.reduce((sum, image) => sum + image.faceCount, 0)
      faceDetectionMessage.value = detectedCount > 0
        ? `얼굴 ${detectedCount}개를 찾았어요. 가림 위치를 직접 확인해 주세요.`
        : "자동 감지 결과가 없어요. 필요하면 수동으로 얼굴을 추가해 주세요."
      await saveNow()
    } finally {
      busy.value = false
    }
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

  function updateMasks(imageId: string, masks: FaceMask[]) {
    const image = draft.value?.images.find((item) => item.id === imageId)
    if (!image) return
    image.masks = JSON.parse(JSON.stringify(masks)) as FaceMask[]
    image.maskConfirmedAt = null
  }

  async function confirmMasks(now = new Date().toISOString()) {
    if (!draft.value) throw new Error("작성 중인 글이 없어요.")
    for (const image of draft.value.images.filter((item) => item.status === "ready")) {
      const source = await services.repository.getImageBlob(image.editedBlobId)
      if (!source) throw new Error(`${image.name} 편집본을 찾지 못했어요.`)
      const masked = await services.applyMasks(source, image.masks)
      await services.repository.saveDraft(draft.value, [{ id: image.editedBlobId, draftId: draft.value.id, blob: masked, expiresAt: image.expiresAt }])
      image.maskConfirmedAt = now
    }
    draft.value.step = "organize"
    draft.value.updatedAt = now
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
    current.brief = await services.ai.analyzeImages({
      memo: current.sourceMemo,
      mustInclude: current.mustInclude,
      avoid: current.avoid,
      writingMode: current.writingMode,
      naverTone: current.naverTone,
      instagramTone: current.instagramTone,
      images: current.images.map(({ id, isCover, sortOrder }) => ({ id, isCover, sortOrder }))
    })
    current.briefConfirmed = false
    current.step = "brief"
    current.updatedAt = new Date().toISOString()
    await saveNow()
    return current.brief
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

  async function generateAll() {
    const current = draft.value
    const brief = current?.brief
    if (!current || !brief || !current.briefConfirmed) {
      throw new Error("AI가 이해한 내용을 확인한 뒤 생성해 주세요.")
    }

    const input = {
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

    current.naver = naver.status === "fulfilled"
      ? { status: "success", data: naver.value, error: null }
      : { status: "error", data: current.naver.data, error: errorMessage(naver.reason) }
    current.instagram = instagram.status === "fulfilled"
      ? { status: "success", data: instagram.value, error: null }
      : { status: "error", data: current.instagram.data, error: errorMessage(instagram.reason) }
    current.step = "results"
    const reviewText = [current.naver.data?.body, current.instagram.data?.captionLong].filter(Boolean).join("\n")
    current.review = await services.ai.review({ text: reviewText, maskedFacesConfirmed: current.images.every((image) => Boolean(image.maskConfirmedAt)) })
    current.updatedAt = new Date().toISOString()
    await saveNow()
  }

  async function retryChannel(channel: "naver" | "instagram") {
    if (!draft.value?.brief) throw new Error("공통 콘텐츠 브리프가 없어요.")
    const current = draft.value
    const input = channelInput(current)
    if (channel === "naver") current.naver = { status: "loading", data: current.naver.data, error: null }
    else current.instagram = { status: "loading", data: current.instagram.data, error: null }
    try {
      if (channel === "naver") current.naver = { status: "success", data: await services.ai.generateNaver(input), error: null }
      else current.instagram = { status: "success", data: await services.ai.generateInstagram(input), error: null }
    } catch (error) {
      if (channel === "naver") current.naver = { status: "error", data: current.naver.data, error: errorMessage(error) }
      else current.instagram = { status: "error", data: current.instagram.data, error: errorMessage(error) }
    }
    await saveNow()
  }

  async function rewrite(request: { channel: "naver" | "instagram"; section: string; instruction: string }) {
    if (!draft.value) throw new Error("작성 중인 글이 없어요.")
    const currentText = sectionText(draft.value, request.channel, request.section)
    const input: RewriteInput = {
      ...request,
      currentText,
      memo: draft.value.sourceMemo,
      tone: request.channel === "naver" ? draft.value.naverTone : draft.value.instagramTone
    }
    const rewritten = await services.ai.rewriteSection(input)

    if (request.channel === "naver") {
      const result = draft.value.naver.data
      if (!result) throw new Error("먼저 네이버 콘텐츠를 생성해 주세요.")
      if (request.section === "title") result.titles[0] = rewritten.text
      else if (request.section === "intro") result.introOptions[0] = rewritten.text
      else result.body = rewritten.text
    } else {
      const result = draft.value.instagram.data
      if (!result) throw new Error("먼저 인스타그램 콘텐츠를 생성해 주세요.")
      if (request.section === "hook") result.hookOptions[0] = rewritten.text
      else if (request.section === "short") result.captionShort = rewritten.text
      else if (request.section === "hashtags") result.hashtags = rewritten.text.split(/\s+/).filter((value) => value.startsWith("#"))
      else result.captionLong = rewritten.text
    }

    draft.value.updatedAt = new Date().toISOString()
    await saveNow()
  }

  async function copy(request: { channel: "naver" | "instagram"; part: "title" | "body" | "hashtags" | "all" }) {
    if (!draft.value) throw new Error("복사할 글이 없어요.")
    const text = copyText(draft.value, request.channel, request.part)
    const result = await services.clipboard.copy(text)
    return { ...result, fallback: result.ok ? null : text }
  }

  async function selectOption(request: { channel: "naver" | "instagram"; kind: "title" | "intro" | "hook"; index: number }) {
    if (!draft.value) return
    let options: string[] | undefined
    if (request.channel === "naver" && request.kind === "title") options = draft.value.naver.data?.titles
    else if (request.channel === "naver" && request.kind === "intro") options = draft.value.naver.data?.introOptions
    else if (request.channel === "instagram" && request.kind === "hook") options = draft.value.instagram.data?.hookOptions
    if (!options?.[request.index]) return
    const [selected] = options.splice(request.index, 1)
    options.unshift(selected)
    await saveNow()
  }

  async function finalize(now = new Date().toISOString()) {
    if (!draft.value) throw new Error("완료할 글이 없어요.")
    draft.value.finalizedAt = now
    draft.value.updatedAt = now
    draft.value.title = draft.value.naver.data?.titles[0] ?? draft.value.instagram.data?.hookOptions[0] ?? "완료한 콘텐츠"
    await services.repository.finalize(draft.value)
    await saveNow()
    history.value = await services.repository.listHistory()
  }

  async function discard() {
    if (!draft.value) return
    await services.repository.deleteDraft(draft.value.id)
    draft.value = null
  }

  return {
    draft, drafts, history, saveStatus, lastSavedAt, busy, faceDetectionMessage,
    create, loadHome, load, saveNow, addFiles, beginMasking, retryImage, updateMasks, confirmMasks,
    reorder, chooseCover, removeImage, updateMemo, analyze, updateBrief, confirmBrief,
    generateAll, retryChannel, rewrite, selectOption, copy, finalize, discard
  }
})

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "생성 중 알 수 없는 오류가 발생했어요."
}

function channelInput(current: StudioDraft) {
  if (!current.brief) throw new Error("공통 콘텐츠 브리프가 없어요.")
  return {
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
    return naver.body
  }
  const instagram = draft.instagram.data
  if (!instagram) throw new Error("먼저 인스타그램 콘텐츠를 생성해 주세요.")
  if (section === "hook") return instagram.hookOptions[0] ?? ""
  if (section === "short") return instagram.captionShort
  if (section === "hashtags") return instagram.hashtags.join(" ")
  return instagram.captionLong
}
