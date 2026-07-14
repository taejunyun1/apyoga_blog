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

const analysisBrief: ContentBrief = {
  ...brief,
  imageDescriptions: [
    { imageId: "image-1", description: "큰 창으로 햇살이 들어오는 요가원에서 매트 위에 서 있는 장면" },
    { imageId: "image-2", description: "나무 바닥 위 매트 곁에서 두 팔을 길게 뻗은 장면" },
  ],
}

const rewriteInput = {
  channel: "naver" as const,
  section: "intro",
  instruction: "감성 줄이기",
  currentText: "조용한 감정이 오래 머무는 저녁이었습니다.",
  memo: "어깨와 흉곽을 살핀 수련",
  avoid: "치료, 완치",
  tone: "plain" as const,
}

const titleBodyRewriteInput = {
  currentTitle: "호흡으로 돌아본 일요일 수련",
  currentBody: "기존 호흡 기록을 차분하게 이어 갑니다. ".repeat(60),
  instruction: "최근 글과 다르게",
  memo: "어깨와 흉곽을 살핀 수련",
  photoContext: "전체 분위기: 따뜻하고 고요함\n사진 설명: 우드 바닥과 싱잉볼이 만든 차분한 결",
  avoid: "치료, 완치",
  tone: "emotional" as const,
}

const remoteTitleBodyRewrite = {
  title: "고요한 공간에서 이어진 일요일의 호흡",
  body: "공간의 결을 감각과 여운으로 풀어낸 새로운 네이버 본문입니다. ".repeat(60),
}

function validNaver() {
  return {
    titles: ["천천히 여는 저녁", "몸의 감각을 듣는 시간", "차분하게 이어 간 수련"],
    introOptions: ["오늘의 몸을 살폈습니다.", "작은 움직임에서 시작했습니다.", "편안한 리듬을 찾았습니다."],
    body: "호흡을 따라 어깨와 흉곽의 감각을 차분하게 살폈습니다. ".repeat(20),
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
  it("posts one structured request and returns a paired Naver title and body rewrite", async () => {
    const local = new LocalAIProvider()
    const fallback = vi.spyOn(local, "rewriteNaverTitleAndBody")
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      source: "openai",
      data: remoteTitleBodyRewrite,
    }))
    const provider = new OpenAIProvider({ fetcher, local })

    await expect(provider.rewriteNaverTitleAndBody(titleBodyRewriteInput)).resolves.toEqual({
      title: remoteTitleBodyRewrite.title,
      body: remoteTitleBodyRewrite.body.trim(),
    })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0][0]).toBe("/api/content/rewrite")
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      kind: "naver-title-body",
      ...titleBodyRewriteInput,
    })
    expect(fallback).not.toHaveBeenCalled()
  })

  it.each([
    ["a network error", () => Promise.reject(new TypeError("offline"))],
    ["a malformed response", () => Promise.resolve(Response.json({ source: "openai", data: { title: "새 제목" } }))],
  ])("uses the local title-body rewrite for %s", async (_label, fetchResult) => {
    const local = new LocalAIProvider()
    const fallback = vi.spyOn(local, "rewriteNaverTitleAndBody")
    const provider = new OpenAIProvider({ fetcher: vi.fn<typeof fetch>().mockImplementation(fetchResult), local })

    const result = await provider.rewriteNaverTitleAndBody(titleBodyRewriteInput)

    expect(result.title).not.toBe(titleBodyRewriteInput.currentTitle)
    expect(result.body).not.toBe(titleBodyRewriteInput.currentBody)
    expect(fallback).toHaveBeenCalledWith(titleBodyRewriteInput)
  })

  it("sends analysis-only image data to the remote vision endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ source: "openai", data: analysisBrief }))
    const local = new LocalAIProvider()
    const fallback = vi.spyOn(local, "analyzeImages")
    const provider = new OpenAIProvider({ fetcher, local })
    const input = {
      ...analyzeInput,
      images: analyzeInput.images.map((image, index) => ({
        ...image,
        dataUrl: `data:image/jpeg;base64,cGl4ZWxzLTI${index}=`,
      })),
    }

    await expect(provider.analyzeImages(input)).resolves.toEqual(analysisBrief)
    expect(fallback).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0][0]).toBe("/api/content/analyze-images")
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(input)
  })

  it("fails visibly instead of producing a generic local brief when vision analysis fails", async () => {
    const local = new LocalAIProvider()
    const fallback = vi.spyOn(local, "analyzeImages")
    const provider = new OpenAIProvider({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 502 })),
      local,
    })

    await expect(provider.analyzeImages({
      ...analyzeInput,
      images: analyzeInput.images.map((image) => ({ ...image, dataUrl: "data:image/jpeg;base64,cGl4ZWxz" })),
    })).rejects.toThrow("사진 분석")
    expect(fallback).not.toHaveBeenCalled()
  })

  it("requests a remote rewrite without photo data", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      source: "openai",
      data: { section: "intro", text: "호흡을 살피며 수련을 시작했습니다." },
    }))
    const provider = new OpenAIProvider({ fetcher, local: new LocalAIProvider() })
    const inputWithPrivateImageData = {
      ...rewriteInput,
      photo: "blob:private-photo",
      thumbnailUrl: "blob:private-thumbnail",
      editedBlobId: "private-edit",
    }

    await expect(provider.rewriteSection(inputWithPrivateImageData)).resolves.toEqual({
      section: "intro",
      text: "호흡을 살피며 수련을 시작했습니다.",
    })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0][0]).toBe("/api/content/rewrite")
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    })
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(rewriteInput)
  })

  it.each([
    [
      "a Naver body",
      { ...rewriteInput, section: "body", currentText: "기존 네이버 본문 ".repeat(80) },
      "호흡과 몸의 감각을 차분히 살피며 수련을 이어 갔습니다. ".repeat(30),
    ],
    [
      "hashtags",
      { ...rewriteInput, channel: "instagram", section: "hashtags", currentText: "#에이피요가 #요가기록" },
      "#요가 #호흡 #마음챙김",
    ],
  ] as const)("accepts a valid remote rewrite for %s", async (_label, input, text) => {
    const local = new LocalAIProvider()
    const fallback = vi.spyOn(local, "rewriteSection")
    const provider = new OpenAIProvider({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json({
        source: "openai",
        data: { section: input.section, text },
      })),
      local,
    })

    await expect(provider.rewriteSection(input)).resolves.toEqual({ section: input.section, text: text.trim() })
    expect(fallback).not.toHaveBeenCalled()
  })

  it.each([
    ["a 400 response", () => new Response(null, { status: 400 })],
    ["a 502 response", () => new Response(null, { status: 502 })],
    ["malformed JSON", () => new Response("{", { status: 200, headers: { "Content-Type": "application/json" } })],
    ["a non-object envelope", () => Response.json(null)],
    ["an extra envelope field", () => Response.json({ source: "openai", data: { section: "intro", text: "새 문구" }, traceId: "private" })],
    ["a non-OpenAI source", () => Response.json({ source: "local-fallback", data: { section: "intro", text: "새 문구" } })],
    ["an extra data field", () => Response.json({ source: "openai", data: { section: "intro", text: "새 문구", internal: true } })],
    ["a mismatched section", () => Response.json({ source: "openai", data: { section: "title", text: "새 제목" } })],
    ["empty text", () => Response.json({ source: "openai", data: { section: "intro", text: "   " } })],
    ["unchanged text", () => Response.json({ source: "openai", data: { section: "intro", text: rewriteInput.currentText } })],
    ["a forbidden expression", () => Response.json({ source: "openai", data: { section: "intro", text: "치료를 위한 글" } })],
    ["a direct medical claim", () => Response.json({ source: "openai", data: { section: "intro", text: "통증이 나아집니다." } })],
  ])("uses the local rewrite once for %s", async (_label, response) => {
    const local = new LocalAIProvider()
    const fallback = vi.spyOn(local, "rewriteSection")
    const provider = new OpenAIProvider({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response()),
      local,
    })

    const result = await provider.rewriteSection(rewriteInput)

    expect(result.text).not.toBe(rewriteInput.currentText)
    expect(fallback).toHaveBeenCalledOnce()
  })

  it("uses the local rewrite once for a network error", async () => {
    const local = new LocalAIProvider()
    const fallback = vi.spyOn(local, "rewriteSection")
    const provider = new OpenAIProvider({
      fetcher: vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline")),
      local,
    })

    const result = await provider.rewriteSection(rewriteInput)

    expect(result.text).not.toBe(rewriteInput.currentText)
    expect(fallback).toHaveBeenCalledOnce()
  })

  it.each([
    [
      "a short Naver body",
      { ...rewriteInput, section: "body", currentText: "기존 네이버 본문 ".repeat(80) },
      "짧은 본문",
    ],
    [
      "an invalid hashtag token",
      { ...rewriteInput, channel: "instagram", section: "hashtags", currentText: "#에이피요가 #요가기록" },
      "#요가 잘못된태그",
    ],
  ] as const)("uses the local rewrite once for %s", async (_label, input, text) => {
    const local = new LocalAIProvider()
    const fallback = vi.spyOn(local, "rewriteSection")
    const provider = new OpenAIProvider({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json({
        source: "openai",
        data: { section: input.section, text },
      })),
      local,
    })

    const result = await provider.rewriteSection(input)

    expect(result.text).not.toBe(input.currentText)
    expect(fallback).toHaveBeenCalledOnce()
  })

  it.each([401, 403])("requires authentication for rewrite status %s", async (status) => {
    const onAuthRequired = vi.fn()
    const local = new LocalAIProvider()
    const fallback = vi.spyOn(local, "rewriteSection")
    const provider = new OpenAIProvider({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status })),
      local,
      onAuthRequired,
    })

    await expect(provider.rewriteSection(rewriteInput)).rejects.toThrow("로그인이 필요해요.")
    expect(onAuthRequired).toHaveBeenCalledOnce()
    expect(fallback).not.toHaveBeenCalled()
  })

  it.each([
    ["naver", validNaver()],
    ["instagram", validInstagram()],
  ] as const)("requests %s without image binaries or private image metadata", async (channel, data) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ channel, source: "openai", data }))
    const provider = new OpenAIProvider({ fetcher, local: new LocalAIProvider() })

    const result = channel === "naver"
      ? await provider.generateNaver(channelInput)
      : await provider.generateInstagram(channelInput)

    expect(result.generationSource).toBe("openai")
    expect(result.qualityChecks.avoidedExpressionRemoved).toBe(true)
    expect(result.qualityChecks).not.toHaveProperty("distinctFromNaver")
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

  it("surfaces a contradictory Naver constraint after a content-service fallback", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 502 }))
    const provider = new OpenAIProvider({ fetcher, local: new LocalAIProvider() })
    const input = { ...channelInput, mustInclude: "치료", avoid: "치료" }

    await expect(provider.generateNaver(input)).rejects.toThrow("필수 표현")
  })

  it("surfaces a contradictory Instagram constraint after a content-service fallback", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 502 }))
    const provider = new OpenAIProvider({ fetcher, local: new LocalAIProvider() })
    const input = { ...channelInput, mustInclude: "치료", avoid: "치료" }

    await expect(provider.generateInstagram(input)).rejects.toThrow("필수 표현")
  })

  it.each([
    ["malformed JSON", () => new Response("{", { status: 200, headers: { "Content-Type": "application/json" } })],
    ["a non-object envelope", () => Response.json(null)],
    ["a mismatched channel", () => Response.json({ channel: "instagram", source: "openai", data: validNaver() })],
    ["a non-OpenAI source", () => Response.json({ channel: "naver", source: "local-fallback", data: validNaver() })],
  ])("falls back locally when a 2xx response has %s", async (_label, response) => {
    const local = new LocalAIProvider()
    const fallback = vi.spyOn(local, "generateNaver")
    const provider = new OpenAIProvider({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response()),
      local,
    })

    const result = await provider.generateNaver(channelInput)

    expect(result.generationSource).toBe("local-fallback")
    expect(fallback).toHaveBeenCalledOnce()
  })

  it.each([
    ["a missing field", (({ classInfo: _classInfo, ...data }) => data)(validNaver())],
    ["an extra field", { ...validNaver(), qualityChecks: { trusted: false } }],
    ["the wrong title count", { ...validNaver(), titles: ["하나", "둘"] }],
    ["a non-string intro", { ...validNaver(), introOptions: ["하나", 2, "셋"] }],
    ["a short body", { ...validNaver(), body: "호흡이 있는 짧은 본문" }],
    ["no image placements", { ...validNaver(), imagePlacements: [] }],
    ["an invalid image placement", { ...validNaver(), imagePlacements: [{ imageId: "", afterParagraph: -1, caption: 2 }] }],
    ["non-string hashtags", { ...validNaver(), hashtags: [1] }],
    ["an empty class info field", { ...validNaver(), classInfo: "" }],
  ])("falls back locally when Naver data has %s", async (_label, data) => {
    const local = new LocalAIProvider()
    const fallback = vi.spyOn(local, "generateNaver")
    const provider = new OpenAIProvider({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ channel: "naver", source: "openai", data })),
      local,
    })

    const result = await provider.generateNaver(channelInput)

    expect(result.generationSource).toBe("local-fallback")
    expect(fallback).toHaveBeenCalledOnce()
  })

  it.each([
    ["a missing field", (({ imageOrder: _imageOrder, ...data }) => data)(validInstagram())],
    ["an extra field", { ...validInstagram(), extra: true }],
    ["the wrong hook count", { ...validInstagram(), hookOptions: ["하나", "둘"] }],
    ["a non-string caption", { ...validInstagram(), captionLong: 2 }],
    ["matching long and short captions", { ...validInstagram(), captionShort: validInstagram().captionLong }],
    ["non-string hashtags", { ...validInstagram(), hashtags: [1] }],
    ["an empty cover image ID", { ...validInstagram(), coverImageId: "" }],
    ["an empty image order", { ...validInstagram(), imageOrder: [] }],
  ])("falls back locally when Instagram data has %s", async (_label, data) => {
    const local = new LocalAIProvider()
    const fallback = vi.spyOn(local, "generateInstagram")
    const provider = new OpenAIProvider({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ channel: "instagram", source: "openai", data })),
      local,
    })

    const result = await provider.generateInstagram(channelInput)

    expect(result.generationSource).toBe("local-fallback")
    expect(fallback).toHaveBeenCalledOnce()
  })

  it.each([
    ["naver", { ...validNaver(), titles: ["치료를 말하지 않는 기록", ...validNaver().titles.slice(1)] }],
    ["instagram", { ...validInstagram(), hookOptions: ["치료를 말하지 않는 기록", ...validInstagram().hookOptions.slice(1)] }],
  ] as const)("checks forbidden expressions in every %s publishable field", async (channel, data) => {
    const provider = new OpenAIProvider({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ channel, source: "openai", data })),
      local: new LocalAIProvider(),
    })

    const result = channel === "naver"
      ? await provider.generateNaver(channelInput)
      : await provider.generateInstagram(channelInput)

    expect(result.generationSource).toBe("openai")
    expect(result.qualityChecks.avoidedExpressionRemoved).toBe(false)
    expect(result.qualityChecks).not.toHaveProperty("distinctFromNaver")
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
