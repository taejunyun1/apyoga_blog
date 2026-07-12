import { LocalAIProvider } from "@/adapters/local-ai-provider"
import type { AIProvider, AnalyzeImagesInput, ChannelInput, RewriteInput } from "@/domain/ports"
import type { Channel, InstagramOutput, NaverOutput } from "@/domain/studio"

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
    return this.local.analyzeImages(input)
  }

  rewriteSection(input: RewriteInput) {
    return this.local.rewriteSection(input)
  }

  review(input: { text: string; maskedFacesConfirmed: boolean }) {
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

    const payload = await response.json() as { data: RemoteOutput }
    if (channel === "naver") {
      const data = payload.data as RemoteNaver
      return {
        ...data,
        generationSource: "openai",
        qualityChecks: {
          avoidedExpressionRemoved: !forbiddenExpressions(input.avoid).some((term) => data.body.includes(term)),
          includesRequiredPhrase: !input.mustInclude.trim() || data.body.includes(input.mustInclude.trim()),
        },
      }
    }

    const data = payload.data as RemoteInstagram
    return {
      ...data,
      generationSource: "openai",
      qualityChecks: {
        distinctFromNaver: true,
        avoidedExpressionRemoved: !forbiddenExpressions(input.avoid).some((term) => data.captionLong.includes(term)),
      },
    }
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
