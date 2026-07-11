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
