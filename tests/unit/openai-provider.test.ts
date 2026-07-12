import { describe, expect, it, vi } from "vitest"
import { LocalAIProvider } from "@/adapters/local-ai-provider"
import { OpenAIProvider } from "@/adapters/openai-provider"
import type { ChannelInput } from "@/domain/ports"
import type { ContentBrief } from "@/domain/studio"
import { analyzeInput } from "../fixtures"

const brief: ContentBrief = {
  classSummary: "차분한 저녁 수련",
  overallMood: "차분함",
  bodyFocus: ["어깨", "흉곽"],
  visualKeywords: ["호흡", "정돈"],
  imageDescriptions: [{ imageId: "image-1", description: "첫 번째 수련 장면" }],
  recommendedCoverImageId: "image-1",
  recommendedImageOrder: ["image-1", "image-2"],
  uncertainClaims: ["수업 시간을 확인해 주세요."],
  seasonalContext: "여름",
  userMemoSummary: "어깨와 흉곽을 천천히 연 수련",
}

const channelInput: ChannelInput = { ...analyzeInput, brief }

function validNaver() {
  return {
    titles: ["천천히 여는 저녁", "몸의 감각을 듣는 시간", "차분하게 이어 간 수련"],
    introOptions: ["오늘의 몸을 살폈습니다.", "작은 움직임에서 시작했습니다.", "편안한 리듬을 찾았습니다."],
    body: "호흡을 따라 어깨와 흉곽의 감각을 차분하게 살폈습니다. ".repeat(12),
    imagePlacements: [{ imageId: "image-1", afterParagraph: 2, caption: "수련 장면" }],
    hashtags: ["#에이피요가", "#요가기록"],
    classInfo: "수업 정보는 게시 전에 확인해 주세요.",
  }
}

function validInstagram() {
  return {
    hookOptions: ["몸의 속도를 듣는 시간", "작은 움직임에서 시작하기", "오늘의 감각을 따라가기"],
    captionLong: "호흡을 따라 어깨와 흉곽의 감각을 천천히 살피며 편안한 움직임을 이어 갔습니다.",
    captionShort: "호흡으로 돌아온 저녁 수련.",
    hashtags: ["#에이피요가", "#요가기록"],
    coverImageId: "image-1",
    imageOrder: ["image-1", "image-2"],
  }
}

describe("OpenAIProvider", () => {
  it.each([
    ["naver", validNaver()],
    ["instagram", validInstagram()],
  ] as const)("requests %s without image binaries or private image metadata", async (channel, data) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ channel, source: "openai", data: { ...data, qualityChecks: { trusted: false } } }))
    const provider = new OpenAIProvider({ fetcher, local: new LocalAIProvider() })

    const result = channel === "naver"
      ? await provider.generateNaver(channelInput)
      : await provider.generateInstagram(channelInput)

    expect(result.generationSource).toBe("openai")
    expect(result.qualityChecks).not.toHaveProperty("trusted")
    expect(fetcher).toHaveBeenCalledOnce()
    const init = fetcher.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(init.body))
    expect(fetcher.mock.calls[0][0]).toBe("/api/content/generate")
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" })
    expect(body).toEqual({
      channel,
      input: {
        memo: channelInput.memo,
        mustInclude: channelInput.mustInclude,
        avoid: channelInput.avoid,
        writingMode: channelInput.writingMode,
        tone: channel === "naver" ? channelInput.naverTone : channelInput.instagramTone,
        brief: {
          classSummary: brief.classSummary,
          overallMood: brief.overallMood,
          bodyFocus: brief.bodyFocus,
          imageDescriptions: brief.imageDescriptions,
          recommendedCoverImageId: brief.recommendedCoverImageId,
          recommendedImageOrder: brief.recommendedImageOrder,
        },
      },
    })
    expect(JSON.stringify(body)).not.toContain("blob:")
    expect(JSON.stringify(body)).not.toContain("editedBlobId")
    expect(JSON.stringify(body)).not.toContain("thumbnailUrl")
    expect(JSON.stringify(body)).not.toContain("hash")
    expect(JSON.stringify(body)).not.toContain("masks")
  })

  it("falls back locally for only a content-service failure", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 502 }))
    const provider = new OpenAIProvider({ fetcher, local: new LocalAIProvider() })

    const result = await provider.generateNaver(channelInput)

    expect(result.generationSource).toBe("local-fallback")
    expect(result.body.trim().length).toBeGreaterThanOrEqual(500)
  })

  it.each([401, 403])("requires authentication for %s without using local fallback", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }))
    const local = new LocalAIProvider()
    const fallback = vi.spyOn(local, "generateNaver")
    const onAuthRequired = vi.fn()
    const provider = new OpenAIProvider({ fetcher, local, onAuthRequired })

    await expect(provider.generateNaver(channelInput)).rejects.toThrow("로그인이 필요해요.")

    expect(onAuthRequired).toHaveBeenCalledOnce()
    expect(fallback).not.toHaveBeenCalled()
  })

  it.each([
    ["a client error", () => Promise.resolve(new Response(null, { status: 400 }))],
    ["a network error", () => Promise.reject(new TypeError("offline"))],
  ])("does not use local fallback for %s", async (_label, response) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(response)
    const local = new LocalAIProvider()
    const fallback = vi.spyOn(local, "generateNaver")
    const provider = new OpenAIProvider({ fetcher, local })

    await expect(provider.generateNaver(channelInput)).rejects.toThrow()

    expect(fallback).not.toHaveBeenCalled()
  })
})
