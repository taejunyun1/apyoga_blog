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

  it("keeps the final Naver body long enough when filtering removes template vocabulary", async () => {
    const provider = new LocalAIProvider()
    const avoid = "오늘,수련,호흡,감각,움직임,차분,몸,마음,시간,리듬,과정,기록,사진,집중,변화,확인,경험,요가"
    const brief = await provider.analyzeImages({ ...analyzeInput, avoid })
    const naver = await provider.generateNaver({ ...analyzeInput, avoid, brief })

    expect(naver.body.trim().length).toBeGreaterThanOrEqual(500)
    for (const expression of avoid.split(",")) {
      expect(naver.body).not.toContain(expression)
    }
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
