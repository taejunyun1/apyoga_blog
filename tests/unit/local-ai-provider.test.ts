import { describe, expect, it } from "vitest"
import { LocalAIProvider } from "@/adapters/local-ai-provider"
import { analyzeInput } from "../fixtures"

describe("LocalAIProvider", () => {
  it("builds one editable common brief from memo and image metadata", async () => {
    const provider = new LocalAIProvider()
    const brief = await provider.analyzeImages(analyzeInput)

    expect(brief.classSummary).toContain("어깨와 흉곽")
    expect(brief.overallMood).toContain("차분")
    expect(brief.bodyFocus).toEqual(expect.arrayContaining(["어깨", "흉곽"]))
    expect(brief.recommendedImageOrder).toEqual(["image-1", "image-2"])
  })

  it("generates distinct Naver and Instagram output shapes", async () => {
    const provider = new LocalAIProvider()
    const brief = await provider.analyzeImages(analyzeInput)
    const channelInput = { ...analyzeInput, brief }
    const [naver, instagram] = await Promise.all([
      provider.generateNaver(channelInput),
      provider.generateInstagram(channelInput)
    ])

    expect(naver.titles).toHaveLength(3)
    expect(naver.introOptions).toHaveLength(3)
    expect(naver.body).toContain("호흡")
    expect(naver.body).not.toContain("치료")
    expect(instagram.hookOptions).toHaveLength(3)
    expect(instagram.captionShort.length).toBeLessThan(instagram.captionLong.length)
    expect(instagram.hashtags.length).toBeGreaterThanOrEqual(5)
  })

  it("weaves concrete photo details into emotional local fallback copy without scene enumeration", async () => {
    const provider = new LocalAIProvider()
    const analyzed = await provider.analyzeImages(analyzeInput)
    const brief = {
      ...analyzed,
      imageDescriptions: [
        { imageId: "image-1", description: "사진에는 큰 창으로 햇살이 들어오는 요가원에서 매트 위에 서 있는 장면" },
        { imageId: "image-2", description: "이미지 속 나무 바닥 위 매트 곁에서 두 팔을 길게 뻗은 장면" },
      ],
    }
    const [naver, instagram] = await Promise.all([
      provider.generateNaver({ ...analyzeInput, brief }),
      provider.generateInstagram({ ...analyzeInput, brief }),
    ])

    expect(naver.body).toContain("햇살")
    expect(naver.body).toContain("나무 바닥")
    expect(naver.body).toContain("여운")
    expect(naver.body).not.toMatch(/(?:\d+번째|첫 번째)\s*사진/u)
    expect(naver.body).not.toMatch(/(?:사진|이미지)\s*(?:에는|은|는|에서|속|을|를|으로)/u)
    expect(naver.imagePlacements[0].caption).toContain("큰 창으로 햇살")
    expect(naver.imagePlacements[1].caption).toContain("나무 바닥")
    expect(instagram.captionLong).toContain("햇살")
    expect(instagram.captionLong).toContain("나무 바닥")
    expect(instagram.captionLong).toContain("여운")
    expect(instagram.captionLong).not.toMatch(/(?:\d+번째|첫 번째)\s*사진/u)
    expect(instagram.captionLong).not.toMatch(/(?:사진|이미지)\s*(?:에는|은|는|에서|속|을|를|으로)/u)
  })

  it("keeps the local Naver fallback at 500 characters after filtering", async () => {
    const provider = new LocalAIProvider()
    const brief = await provider.analyzeImages({
      ...analyzeInput,
      memo: "짧은 수련 메모 치료",
      avoid: "치료,과장"
    })
    const naver = await provider.generateNaver({
      ...analyzeInput,
      memo: "짧은 수련 메모 치료",
      avoid: "치료,과장",
      brief
    })

    expect(naver.body.trim().length).toBeGreaterThanOrEqual(500)
    expect(naver.body).not.toContain("치료")
    expect(naver.body).not.toContain("과장")
  })

  it("rejects contradictory required and forbidden Naver copy instead of publishing either constraint", async () => {
    const provider = new LocalAIProvider()
    const input = { ...analyzeInput, mustInclude: "치료", avoid: "치료" }
    const brief = await provider.analyzeImages(input)

    await expect(provider.generateNaver({ ...input, brief })).rejects.toThrow("필수 표현")
  })

  it("returns a channel error instead of manufacturing length when constraints are contradictory", async () => {
    const provider = new LocalAIProvider()
    const avoid = "오늘,수련,호흡,감각,움직임,차분,몸,마음,시간,리듬,과정,기록,사진,집중,변화,확인,경험,요가"
    const brief = await provider.analyzeImages({ ...analyzeInput, avoid })

    await expect(provider.generateNaver({ ...analyzeInput, avoid, brief })).rejects.toThrow("필수 표현")
  })

  it("uses distinct continuation paragraphs to extend a filtered Naver body", async () => {
    const provider = new LocalAIProvider()
    const brief = await provider.analyzeImages(analyzeInput)
    const avoid = [
      "오늘은 어깨과 흉곽에 천천히 주의를 기울이며 수련을 시작했습니다.",
      "호흡을 따라 서두르지 않고 몸과 마음이 현재에 도착할 시간을 충분히 두었습니다.",
      "어깨와 흉곽을 천천히 열어간 차분한 저녁 수련라는 기록을 바탕으로 각 동작의 크기보다 움직임이 이어지는 과정과 그 사이의 여백을 살펴보았습니다.",
      "숨을 들이쉴 때와 내쉴 때 달라지는 감각을 관찰하며 어깨과 흉곽 주변의 긴장을 억지로 밀어내지 않고 각자의 편안한 범위 안에서 움직였습니다.",
      "사진에 담긴 장면마다 공간의 구조와 빛, 소도구의 색과 배치가 다르게 보였습니다.",
      "실제로 확인되는 요소만 따라가며 수련 공간의 흐름을 차분히 기록했습니다.",
      "수련이 깊어질수록 큰 변화보다 작고 분명한 신호를 알아차리는 일이 중요하다는 것을 다시 확인했습니다.",
      "잠시 쉬는 선택도 오늘의 몸에 맞는 좋은 움직임이 될 수 있습니다.",
      "마무리에서는 처음과 달라진 호흡과 바닥에 닿는 감각을 천천히 확인했습니다.",
      "일상으로 돌아간 뒤에도 오늘 발견한 편안한 리듬을 짧게 떠올려 보세요."
    ].join("\n")
    const naver = await provider.generateNaver({ ...analyzeInput, avoid, brief })
    const paragraphs = naver.body.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean)

    expect(naver.body.trim().length).toBeGreaterThanOrEqual(500)
    expect(new Set(paragraphs).size).toBe(paragraphs.length)
  })

  it("rejects a required phrase that becomes forbidden after filtering", async () => {
    const provider = new LocalAIProvider()
    const input = { ...analyzeInput, mustInclude: "치과장료", avoid: "치료,과장" }
    const brief = await provider.analyzeImages(input)
    await expect(provider.generateInstagram({ ...input, brief })).rejects.toThrow("필수 표현")
  })

  it("rejects contradictory required and forbidden Instagram copy", async () => {
    const provider = new LocalAIProvider()
    const input = { ...analyzeInput, mustInclude: "치료", avoid: "치료" }
    const brief = await provider.analyzeImages(input)

    await expect(provider.generateInstagram({ ...input, brief })).rejects.toThrow("필수 표현")
  })

  it("removes unsafe memo and edited brief fragments from every local publishable field", async () => {
    const provider = new LocalAIProvider()
    const unsafe = "통증이 나아집니다"
    const input = { ...analyzeInput, memo: `${unsafe} 어깨 수련`, mustInclude: "호흡", avoid: "" }
    const analyzed = await provider.analyzeImages(input)
    const brief = {
      ...analyzed,
      overallMood: unsafe,
      bodyFocus: [unsafe, "어깨"],
      userMemoSummary: unsafe,
    }

    const [naver, instagram] = await Promise.all([
      provider.generateNaver({ ...input, brief }),
      provider.generateInstagram({ ...input, brief }),
    ])
    const publishable = [
      ...naver.titles, ...naver.introOptions, naver.body,
      ...naver.imagePlacements.map((placement) => placement.caption), ...naver.hashtags, naver.classInfo,
      ...instagram.hookOptions, instagram.captionLong, instagram.captionShort, ...instagram.hashtags,
    ].join("\n")

    expect(publishable).not.toContain(unsafe)
    expect(naver.qualityChecks.avoidedExpressionRemoved).toBe(true)
    expect(instagram.qualityChecks.avoidedExpressionRemoved).toBe(true)
  })

  it("rejects an unsafe required medical claim for both local channels", async () => {
    const provider = new LocalAIProvider()
    const input = { ...analyzeInput, mustInclude: "통증이 나아집니다", avoid: "" }
    const brief = await provider.analyzeImages(input)

    await expect(provider.generateNaver({ ...input, brief })).rejects.toThrow("필수 표현")
    await expect(provider.generateInstagram({ ...input, brief })).rejects.toThrow("필수 표현")
  })

  it("never manufactures Naver length with a repeated padding glyph", async () => {
    const provider = new LocalAIProvider()
    const brief = await provider.analyzeImages(analyzeInput)
    const naver = await provider.generateNaver({ ...analyzeInput, brief })
    const paragraphs = naver.body.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean)
    const sentences = naver.body.split(/[.!?]/).map((sentence) => sentence.trim()).filter(Boolean)

    expect(naver.body.trim().length).toBeGreaterThanOrEqual(500)
    expect(naver.body).not.toMatch(/(.)\1{20,}/u)
    expect(new Set(paragraphs).size).toBe(paragraphs.length)
    expect(new Set(sentences).size).toBe(sentences.length)
  })

  it("returns a channel error when independently filtered paragraphs cannot reach 500 meaningful characters", async () => {
    const provider = new LocalAIProvider()
    const baselineBrief = await provider.analyzeImages(analyzeInput)
    const baseline = await provider.generateNaver({ ...analyzeInput, brief: baselineBrief })
    const avoid = [...new Set([...baseline.body].filter((character) => /[가-힣]/.test(character)))].join(",")
    const input = { ...analyzeInput, memo: "Memo", mustInclude: "ZXQ", avoid }
    const brief = { ...baselineBrief, bodyFocus: ["Focus"] }

    await expect(provider.generateNaver({ ...input, brief })).rejects.toThrow("의미 있는 네이버 본문 500자")
  })

  it("rewrites only the requested section without accepting images", async () => {
    const provider = new LocalAIProvider()
    const rewritten = await provider.rewriteSection({
      channel: "naver",
      section: "intro",
      currentText: "오늘의 수련",
      instruction: "감성 줄이기",
      memo: analyzeInput.memo,
      avoid: analyzeInput.avoid,
      tone: "plain"
    })

    expect(rewritten.section).toBe("intro")
    expect(rewritten.text).toContain("호흡")
    expect(rewritten.text).not.toContain("사진")
  })

  it("rewrites a Naver title and 500-character body together", async () => {
    const provider = new LocalAIProvider()
    const input = {
      currentTitle: "호흡으로 돌아본 일요일 수련",
      currentBody: "기존 호흡 기록을 차분하게 이어 갑니다. ".repeat(60),
      instruction: "최근 글과 다르게",
      memo: analyzeInput.memo,
      photoContext: "전체 분위기: 따뜻하고 고요함\n사진 설명: 우드 바닥과 싱잉볼이 만든 차분한 결",
      avoid: analyzeInput.avoid,
      tone: "emotional" as const,
    }

    const rewritten = await provider.rewriteNaverTitleAndBody(input)

    expect(rewritten.title).not.toBe(input.currentTitle)
    expect(rewritten.body).not.toBe(input.currentBody)
    expect(rewritten.body.trim().length).toBeGreaterThanOrEqual(500)
    expect(rewritten.body).not.toMatch(/(?:사진|이미지)\s*(?:속|에는|은|는|에서|에|을|를|으로)/u)
  })

  it("returns a visibly different sentence on repeated option rewrites", async () => {
    const provider = new LocalAIProvider()
    const request = {
      channel: "naver" as const,
      section: "title",
      currentText: "오늘의 요가 기록",
      instruction: "최근 글과 다르게",
      memo: analyzeInput.memo,
      avoid: analyzeInput.avoid,
      tone: "plain" as const
    }

    const first = await provider.rewriteSection(request)
    const second = await provider.rewriteSection({ ...request, currentText: first.text })

    expect(first.text).not.toBe(request.currentText)
    expect(second.text).not.toBe(first.text)
  })

  it("rewrites Instagram hashtags to a different non-empty hashtag set", async () => {
    const provider = new LocalAIProvider()
    const currentText = "#에이피요가 #요가수련"

    const rewritten = await provider.rewriteSection({
      channel: "instagram",
      section: "hashtags",
      currentText,
      instruction: "해시태그 변경",
      memo: analyzeInput.memo,
      avoid: analyzeInput.avoid,
      tone: "plain"
    })

    expect(rewritten.text).not.toBe(currentText)
    expect(rewritten.text.split(/\s+/).length).toBeGreaterThan(1)
    expect(rewritten.text.split(/\s+/).every((value) => value.startsWith("#"))).toBe(true)
  })

  it.each(["철학 줄이기", "사진 분위기 더하기"])("preserves a complete Naver body for the %s rewrite", async (instruction) => {
    const provider = new LocalAIProvider()
    const brief = await provider.analyzeImages(analyzeInput)
    const naver = await provider.generateNaver({ ...analyzeInput, brief })

    const rewritten = await provider.rewriteSection({
      channel: "naver",
      section: "body",
      currentText: naver.body,
      instruction,
      memo: analyzeInput.memo,
      avoid: analyzeInput.avoid,
      tone: "plain",
    })

    expect(rewritten.text.trim().length).toBeGreaterThanOrEqual(500)
    expect(rewritten.text).not.toBe(naver.body)
    expect(rewritten.text).not.toMatch(/(.)\1{20,}/u)
    const paragraphs = rewritten.text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean)
    expect(new Set(paragraphs).size).toBe(paragraphs.length)
  })

  it("does not invent people or body positions while expanding a photo description locally", async () => {
    const provider = new LocalAIProvider()
    const analyzed = await provider.analyzeImages(analyzeInput)
    const brief = {
      ...analyzed,
      imageDescriptions: [
        { imageId: "image-1", description: "둥근 나무 테이블 위 유리 화병에 분홍 꽃이 놓인 장면" },
        { imageId: "image-2", description: "나무 바닥 위 검은 싱잉볼과 분홍색 책이 놓인 장면" },
      ],
    }
    const naver = await provider.generateNaver({ ...analyzeInput, brief })
    const rewritten = await provider.rewriteSection({
      channel: "naver",
      section: "body",
      currentText: naver.body,
      instruction: "사진 분위기 더하기",
      memo: analyzeInput.memo,
      avoid: analyzeInput.avoid,
      tone: "plain",
    })

    expect(naver.body).not.toContain("집중하는 표정")
    expect(rewritten.text).not.toContain("손의 위치")
    expect(rewritten.text).not.toContain("발의 간격")
    expect(rewritten.text).not.toContain("손발이 바닥")
    expect(rewritten.text).toContain("여운")
  })

  it("stops a repeated body rewrite instead of reversing the whole article", async () => {
    const provider = new LocalAIProvider()
    const brief = await provider.analyzeImages(analyzeInput)
    const naver = await provider.generateNaver({ ...analyzeInput, brief })
    const request = {
      channel: "naver" as const,
      section: "body",
      instruction: "사진 분위기 더하기",
      memo: analyzeInput.memo,
      avoid: analyzeInput.avoid,
      tone: "plain" as const
    }
    const first = await provider.rewriteSection({ ...request, currentText: naver.body })
    const second = await provider.rewriteSection({ ...request, currentText: first.text })

    await expect(provider.rewriteSection({ ...request, currentText: second.text }))
      .rejects.toThrow("다른 안전한 문구")
  })

  it("does not reintroduce a forbidden expression during a Naver body rewrite", async () => {
    const provider = new LocalAIProvider()
    const input = { ...analyzeInput, avoid: "사진" }
    const brief = await provider.analyzeImages(input)
    const naver = await provider.generateNaver({ ...input, brief })

    const rewritten = await provider.rewriteSection({
      channel: "naver",
      section: "body",
      currentText: naver.body,
      instruction: "사진 분위기 더하기",
      memo: input.memo,
      avoid: input.avoid,
      tone: "plain",
    })

    expect(rewritten.text.trim().length).toBeGreaterThanOrEqual(500)
    expect(rewritten.text).not.toContain("사진")
  })

  it("returns deterministic text for identical inputs", async () => {
    const provider = new LocalAIProvider()
    const first = await provider.analyzeImages(analyzeInput)
    const second = await provider.analyzeImages(analyzeInput)

    expect(second).toEqual(first)
  })
})
