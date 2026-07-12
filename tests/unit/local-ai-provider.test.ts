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

  it("reports forbidden Naver copy outside the final body and checks the delivered body for the required phrase", async () => {
    const provider = new LocalAIProvider()
    const input = { ...analyzeInput, mustInclude: "치료", avoid: "치료" }
    const brief = await provider.analyzeImages(input)

    const naver = await provider.generateNaver({ ...input, brief })

    expect(naver.body.trim().length).toBeGreaterThanOrEqual(500)
    expect(naver.body).not.toContain("치료")
    expect([...naver.titles, ...naver.introOptions].join("\n")).toContain("치료")
    expect(naver.qualityChecks).toEqual({
      avoidedExpressionRemoved: false,
      includesRequiredPhrase: false,
    })
  })

  it("keeps the final Naver body long enough when filtering removes template vocabulary", async () => {
    const provider = new LocalAIProvider()
    const avoid = "오늘,수련,호흡,감각,움직임,차분,몸,마음,시간,리듬,과정,기록,사진,집중,변화,확인,경험,요가"
    const brief = await provider.analyzeImages({ ...analyzeInput, avoid })
    const naver = await provider.generateNaver({ ...analyzeInput, avoid, brief })
    const sentences = naver.body.split(/[.!?]/).map((sentence) => sentence.trim()).filter(Boolean)

    expect(naver.body.trim().length).toBeGreaterThanOrEqual(500)
    expect(new Set(sentences).size).toBe(sentences.length)
    for (const expression of avoid.split(",")) {
      expect(naver.body).not.toContain(expression)
    }
  })

  it("uses distinct continuation paragraphs to extend a filtered Naver body", async () => {
    const provider = new LocalAIProvider()
    const brief = await provider.analyzeImages(analyzeInput)
    const avoid = [
      "오늘은 어깨과 흉곽에 천천히 주의를 기울이며 수련을 시작했습니다.",
      "호흡을 따라 서두르지 않고 몸과 마음이 현재에 도착할 시간을 충분히 두었습니다.",
      "어깨와 흉곽을 천천히 열어간 차분한 저녁 수련라는 기록을 바탕으로 각 동작의 크기보다 움직임이 이어지는 과정과 그 사이의 여백을 살펴보았습니다.",
      "숨을 들이쉴 때와 내쉴 때 달라지는 감각을 관찰하며 어깨과 흉곽 주변의 긴장을 억지로 밀어내지 않고 각자의 편안한 범위 안에서 움직였습니다.",
      "사진에 담긴 장면마다 완성된 모양보다 집중하는 표정과 안정된 리듬이 먼저 보였습니다.",
      "서로의 속도를 존중하니 수련 공간도 한결 차분해졌습니다.",
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

  it("keeps Instagram forbidden-expression filtering to one pass", async () => {
    const provider = new LocalAIProvider()
    const input = { ...analyzeInput, mustInclude: "치과장료", avoid: "치료,과장" }
    const brief = await provider.analyzeImages(input)
    const instagram = await provider.generateInstagram({ ...input, brief })

    expect(instagram.captionLong).toContain("치료")
    expect(instagram.captionShort).toContain("치료")
    expect(instagram.captionLong).not.toContain("과장")
    expect(instagram.captionShort).not.toContain("과장")
  })

  it("reports forbidden Instagram copy outside the filtered captions without inventing channel distinctness", async () => {
    const provider = new LocalAIProvider()
    const input = { ...analyzeInput, mustInclude: "치료", avoid: "치료" }
    const brief = await provider.analyzeImages(input)

    const instagram = await provider.generateInstagram({ ...input, brief })

    expect(instagram.captionLong).not.toContain("치료")
    expect(instagram.captionShort).not.toContain("치료")
    expect(instagram.hookOptions.join("\n")).toContain("치료")
    expect(instagram.qualityChecks).toEqual({ avoidedExpressionRemoved: false })
  })

  it("rewrites only the requested section without accepting images", async () => {
    const provider = new LocalAIProvider()
    const rewritten = await provider.rewriteSection({
      channel: "naver",
      section: "intro",
      currentText: "오늘의 수련",
      instruction: "감성 줄이기",
      memo: analyzeInput.memo,
      tone: "plain"
    })

    expect(rewritten.section).toBe("intro")
    expect(rewritten.text).toContain("호흡")
    expect(rewritten.text).not.toContain("사진")
  })

  it("returns deterministic text for identical inputs", async () => {
    const provider = new LocalAIProvider()
    const first = await provider.analyzeImages(analyzeInput)
    const second = await provider.analyzeImages(analyzeInput)

    expect(second).toEqual(first)
  })
})
