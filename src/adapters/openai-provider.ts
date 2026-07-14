import { LocalAIProvider } from "@/adapters/local-ai-provider"
import { isSafePublishableCopy } from "@/domain/content-safety"
import type { AIProvider, AnalyzeImagesInput, ChannelInput, RewriteInput, RewriteOutput } from "@/domain/ports"
import type { Channel, ContentBrief, InstagramOutput, NaverOutput } from "@/domain/studio"

type RemoteNaver = Omit<NaverOutput, "generationSource" | "qualityChecks">
type RemoteInstagram = Omit<InstagramOutput, "generationSource" | "qualityChecks">
type RemoteOutput = RemoteNaver | RemoteInstagram

interface OpenAIProviderOptions {
  fetcher?: typeof fetch
  local?: LocalAIProvider
  onAuthRequired?: () => void
}

function forbiddenExpressions(avoid: string): string[] {
  return avoid.split(/[,\n]/).map((term) => term.trim()).filter(Boolean)
}

function hasExactKeys<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): value is Record<Keys[number], unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function isStringArray(value: unknown, exactLength?: number): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && (exactLength === undefined || value.length === exactLength)
    && value.every((entry) => typeof entry === "string" && entry.length > 0)
}

function isImagePlacement(value: unknown): value is RemoteNaver["imagePlacements"][number] {
  return hasExactKeys(value, ["imageId", "afterParagraph", "caption"])
    && typeof value.imageId === "string"
    && value.imageId.length > 0
    && Number.isInteger(value.afterParagraph)
    && (value.afterParagraph as number) >= 0
    && typeof value.caption === "string"
    && value.caption.length > 0
}

function isRemoteNaver(value: unknown): value is RemoteNaver {
  return hasExactKeys(value, ["titles", "introOptions", "body", "imagePlacements", "hashtags", "classInfo"])
    && isStringArray(value.titles, 3)
    && isStringArray(value.introOptions, 3)
    && typeof value.body === "string"
    && value.body.trim().length >= 500
    && Array.isArray(value.imagePlacements)
    && value.imagePlacements.length > 0
    && value.imagePlacements.every(isImagePlacement)
    && isStringArray(value.hashtags)
    && typeof value.classInfo === "string"
    && value.classInfo.length > 0
}

function isRemoteInstagram(value: unknown): value is RemoteInstagram {
  return hasExactKeys(value, ["hookOptions", "captionLong", "captionShort", "hashtags", "coverImageId", "imageOrder"])
    && isStringArray(value.hookOptions, 3)
    && typeof value.captionLong === "string"
    && value.captionLong.length > 0
    && typeof value.captionShort === "string"
    && value.captionShort.length > 0
    && value.captionLong.trim() !== value.captionShort.trim()
    && isStringArray(value.hashtags)
    && typeof value.coverImageId === "string"
    && value.coverImageId.length > 0
    && isStringArray(value.imageOrder)
}

function naverPublishableText(data: RemoteNaver): string[] {
  return [
    ...data.titles,
    ...data.introOptions,
    data.body,
    ...data.imagePlacements.map((placement) => placement.caption),
    ...data.hashtags,
    data.classInfo,
  ]
}

function instagramPublishableText(data: RemoteInstagram): string[] {
  return [
    ...data.hookOptions,
    data.captionLong,
    data.captionShort,
    ...data.hashtags,
  ]
}

function defaultOnAuthRequired(): void {
  const next = `${window.location.pathname}${window.location.search}`
  window.location.assign(`/login?next=${encodeURIComponent(next)}`)
}

export class OpenAIProvider implements AIProvider {
  constructor(private readonly options: OpenAIProviderOptions = {}) {}

  private get local(): LocalAIProvider {
    return this.options.local ?? new LocalAIProvider()
  }

  analyzeImages(input: AnalyzeImagesInput) {
    return this.analyzeRemotely(input)
  }

  private async analyzeRemotely(input: AnalyzeImagesInput) {
    if (input.images.some((image) => typeof image.dataUrl !== "string" || !image.dataUrl.startsWith("data:image/jpeg;base64,"))) {
      throw new Error("사진 분석용 이미지를 준비하지 못했어요.")
    }
    let response: Response
    try {
      response = await (this.options.fetcher ?? fetch)("/api/content/analyze-images", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toImageAnalysisInput(input)),
      })
    } catch {
      throw new Error("사진 분석에 실패했어요. 잠시 후 다시 시도해 주세요.")
    }

    if (response.status === 401 || response.status === 403) {
      const onAuthRequired = this.options.onAuthRequired ?? defaultOnAuthRequired
      onAuthRequired()
      throw new Error("로그인이 필요해요.")
    }
    if (!response.ok) throw new Error("사진 분석에 실패했어요. 잠시 후 다시 시도해 주세요.")

    const data = await readRemoteImageAnalysis(response, input)
    if (!data) throw new Error("사진 분석 결과를 확인하지 못했어요. 다시 시도해 주세요.")
    return data
  }

  async rewriteSection(input: RewriteInput): Promise<RewriteOutput> {
    let response: Response
    try {
      response = await (this.options.fetcher ?? fetch)("/api/content/rewrite", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toRewriteInput(input)),
      })
    } catch {
      return this.local.rewriteSection(input)
    }

    if (response.status === 401 || response.status === 403) {
      const onAuthRequired = this.options.onAuthRequired ?? defaultOnAuthRequired
      onAuthRequired()
      throw new Error("로그인이 필요해요.")
    }
    if (!response.ok) return this.local.rewriteSection(input)

    const remote = await readRemoteRewrite(response, input)
    return remote ?? this.local.rewriteSection(input)
  }

  review(input: { text: string }) {
    return this.local.review(input)
  }

  generateNaver(input: ChannelInput): Promise<NaverOutput> {
    return this.generate("naver", input, () => this.local.generateNaver(input)) as Promise<NaverOutput>
  }

  generateInstagram(input: ChannelInput): Promise<InstagramOutput> {
    return this.generate("instagram", input, () => this.local.generateInstagram(input)) as Promise<InstagramOutput>
  }

  private async generate(
    channel: Channel,
    input: ChannelInput,
    fallback: () => Promise<NaverOutput | InstagramOutput>,
  ): Promise<NaverOutput | InstagramOutput> {
    const response = await (this.options.fetcher ?? fetch)("/api/content/generate", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, input: toContentInput(channel, input) }),
    })

    if (response.status === 401 || response.status === 403) {
      const onAuthRequired = this.options.onAuthRequired ?? defaultOnAuthRequired
      onAuthRequired()
      throw new Error("로그인이 필요해요.")
    }
    if (response.status >= 500) {
      return { ...(await fallback()), generationSource: "local-fallback" }
    }
    if (!response.ok) throw new Error("AI 생성 요청에 실패했어요.")

    const data = await readRemoteData(response, channel)
    if (!data) return { ...(await fallback()), generationSource: "local-fallback" }

    if (channel === "naver") {
      const naver = data as RemoteNaver
      const publishableText = naverPublishableText(naver)
      return {
        ...naver,
        generationSource: "openai",
        qualityChecks: {
          avoidedExpressionRemoved: !forbiddenExpressions(input.avoid).some((term) => publishableText.some((text) => text.includes(term))),
          includesRequiredPhrase: !input.mustInclude.trim() || naver.body.includes(input.mustInclude.trim()),
        },
      }
    }

    const instagram = data as RemoteInstagram
    const publishableText = instagramPublishableText(instagram)
    return {
      ...instagram,
      generationSource: "openai",
      qualityChecks: {
        avoidedExpressionRemoved: !forbiddenExpressions(input.avoid).some((term) => publishableText.some((text) => text.includes(term))),
      },
    }
  }
}

async function readRemoteData(response: Response, channel: Channel): Promise<RemoteOutput | null> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return null
  }

  if (!hasExactKeys(payload, ["channel", "source", "data"])
    || payload.channel !== channel
    || payload.source !== "openai") {
    return null
  }
  if (channel === "naver") return isRemoteNaver(payload.data) ? payload.data : null
  return isRemoteInstagram(payload.data) ? payload.data : null
}

async function readRemoteImageAnalysis(response: Response, input: AnalyzeImagesInput): Promise<ContentBrief | null> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return null
  }
  if (!hasExactKeys(payload, ["source", "data"])
    || payload.source !== "openai"
    || !isRemoteImageBrief(payload.data, input)) {
    return null
  }
  return payload.data
}

function isRemoteImageBrief(value: unknown, input: AnalyzeImagesInput): value is ContentBrief {
  if (!hasExactKeys(value, [
    "classSummary", "overallMood", "bodyFocus", "visualKeywords", "imageDescriptions",
    "recommendedCoverImageId", "recommendedImageOrder", "uncertainClaims", "seasonalContext", "userMemoSummary",
  ])
    || typeof value.classSummary !== "string"
    || !value.classSummary.trim()
    || typeof value.overallMood !== "string"
    || !value.overallMood.trim()
    || !isStringArray(value.bodyFocus)
    || !isStringArray(value.visualKeywords)
    || !Array.isArray(value.imageDescriptions)
    || !value.imageDescriptions.every((description) => hasExactKeys(description, ["imageId", "description"])
      && typeof description.imageId === "string"
      && typeof description.description === "string"
      && description.description.trim().length >= 12)
    || typeof value.recommendedCoverImageId !== "string"
    || !isStringArray(value.recommendedImageOrder)
    || !Array.isArray(value.uncertainClaims)
    || !value.uncertainClaims.every((claim) => typeof claim === "string")
    || typeof value.seasonalContext !== "string"
    || typeof value.userMemoSummary !== "string") {
    return false
  }
  const ids = input.images.map((image) => image.id)
  const descriptionIds = value.imageDescriptions.map((description) => description.imageId)
  const recommendedImageOrder = value.recommendedImageOrder as string[]
  const recommendedCoverImageId = value.recommendedCoverImageId as string
  return ids.length === descriptionIds.length
    && new Set(descriptionIds).size === ids.length
    && ids.every((id) => descriptionIds.includes(id))
    && ids.length === recommendedImageOrder.length
    && new Set(recommendedImageOrder).size === ids.length
    && ids.every((id) => recommendedImageOrder.includes(id))
    && ids.includes(recommendedCoverImageId)
}

async function readRemoteRewrite(response: Response, input: RewriteInput): Promise<RewriteOutput | null> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return null
  }

  if (!hasExactKeys(payload, ["source", "data"])
    || payload.source !== "openai"
    || !hasExactKeys(payload.data, ["section", "text"])
    || payload.data.section !== input.section
    || typeof payload.data.text !== "string") {
    return null
  }

  const text = payload.data.text.trim()
  if (!text
    || text === input.currentText.trim()
    || (input.channel === "naver" && input.section === "body" && text.length < 500)
    || (input.section === "hashtags"
      && text.split(/\s+/).some((token) => !token.startsWith("#") || token.length < 2))
    || !isSafePublishableCopy([text], input.avoid)) {
    return null
  }

  return { section: input.section, text }
}

function toRewriteInput(input: RewriteInput): RewriteInput {
  return {
    channel: input.channel,
    section: input.section,
    instruction: input.instruction,
    currentText: input.currentText,
    memo: input.memo,
    avoid: input.avoid,
    tone: input.tone,
  }
}

function toImageAnalysisInput(input: AnalyzeImagesInput) {
  return {
    memo: input.memo,
    mustInclude: input.mustInclude,
    avoid: input.avoid,
    writingMode: input.writingMode,
    naverTone: input.naverTone,
    instagramTone: input.instagramTone,
    images: input.images.map((image) => ({
      id: image.id,
      isCover: image.isCover,
      sortOrder: image.sortOrder,
      dataUrl: image.dataUrl,
    })),
  }
}

function toContentInput(channel: Channel, input: ChannelInput) {
  return {
    memo: input.memo,
    mustInclude: input.mustInclude,
    avoid: input.avoid,
    writingMode: input.writingMode,
    tone: channel === "naver" ? input.naverTone : input.instagramTone,
    brief: {
      classSummary: input.brief.classSummary,
      overallMood: input.brief.overallMood,
      bodyFocus: input.brief.bodyFocus,
      imageDescriptions: input.brief.imageDescriptions,
      recommendedCoverImageId: input.brief.recommendedCoverImageId,
      recommendedImageOrder: input.brief.recommendedImageOrder,
    },
  }
}
