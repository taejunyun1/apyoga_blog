import { defineStore } from "pinia"
import { ref } from "vue"
import { BrowserClipboard } from "@/adapters/browser-clipboard"
import { DexieStudioRepository, type EditedImageRecord } from "@/adapters/dexie-repository"
import { prepareImage } from "@/adapters/image-processor"
import { LocalAIProvider } from "@/adapters/local-ai-provider"
import type { AIProvider } from "@/domain/ports"
import { createDraft, type StudioDraft } from "@/domain/studio"
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
}

export interface StudioServices {
  repository: StudioRepository
  ai: AIProvider
  clipboard: BrowserClipboard
  prepareImage: typeof prepareImage
}

function defaultServices(): StudioServices {
  return {
    repository: new DexieStudioRepository(),
    ai: new LocalAIProvider(),
    clipboard: new BrowserClipboard(),
    prepareImage
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

  return { draft, drafts, history, saveStatus, lastSavedAt, create, loadHome, load, saveNow, generateAll, rewrite }
})

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "생성 중 알 수 없는 오류가 발생했어요."
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
