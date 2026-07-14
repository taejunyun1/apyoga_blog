import { describe, expect, it, vi } from "vitest"
import {
  OpenAIImageAnalysisError,
  requestOpenAIImageAnalysis,
  validateImageAnalysis,
} from "../../functions/lib/openai-image-analysis"

const input = {
  memo: "햇살이 들어오는 공간에서 호흡을 살핀 수련",
  mustInclude: "호흡",
  avoid: "치료, 완치",
  writingMode: "body-sense" as const,
  naverTone: "plain" as const,
  instagramTone: "emotional" as const,
  images: [
    {
      id: "image-1",
      isCover: true,
      sortOrder: 0,
      dataUrl: "data:image/jpeg;base64,ZmFrZS1waXhlbHM=",
    },
  ],
}

const analysis = {
  classSummary: "햇살이 비치는 요가원에서 이어간 전신 수련",
  overallMood: "따뜻한 자연광이 들어오는 정돈된 공간",
  bodyFocus: ["전신", "균형"],
  visualKeywords: ["자연광", "매트", "서 있는 동작"],
  imageDescriptions: [{
    imageId: "image-1",
    description: "큰 창으로 햇살이 들어오는 요가원에서 매트 위에 서서 팔을 뻗은 장면",
  }],
  recommendedCoverImageId: "image-1",
  recommendedImageOrder: ["image-1"],
  uncertainClaims: [],
  seasonalContext: "",
  userMemoSummary: "호흡을 살핀 수련",
}

function completed(value: unknown): Response {
  return Response.json({
    status: "completed",
    usage: {
      input_tokens: 120,
      output_tokens: 80,
      input_tokens_details: { cached_tokens: 20 },
    },
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }],
  })
}

describe("OpenAI image analysis", () => {
  it("sends metadata-free data URLs as Responses API image inputs with structured output", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completed(analysis))

    await expect(requestOpenAIImageAnalysis(
      input,
      { OPENAI_API_KEY: "test-key" },
      { fetcher, safetyIdentifier: "hashed-user" },
    )).resolves.toEqual({
      data: analysis,
      responseUsage: { inputTokens: 120, cachedInputTokens: 20, outputTokens: 80 },
    })

    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
    expect(request).toMatchObject({
      store: false,
      safety_identifier: "hashed-user",
      input: [{
        role: "user",
        content: expect.arrayContaining([
          { type: "input_image", image_url: input.images[0].dataUrl, detail: "low" },
        ]),
      }],
      text: { format: { type: "json_schema", name: "ap_yoga_image_analysis", strict: true } },
    })
    expect(JSON.stringify(request)).not.toContain("photo.jpg")
    expect(JSON.stringify(request)).not.toContain("editedBlobId")
    expect(JSON.stringify(request)).not.toContain("EXIF")
  })

  it("rejects analysis that omits an uploaded image or uses an unknown image id", () => {
    expect(() => validateImageAnalysis({ ...analysis, imageDescriptions: [] }, input)).toThrow(OpenAIImageAnalysisError)
    expect(() => validateImageAnalysis({
      ...analysis,
      imageDescriptions: [{ imageId: "unknown", description: "창가의 매트 위에서 팔을 뻗은 장면" }],
    }, input)).toThrow(OpenAIImageAnalysisError)
  })

  it("rejects generic placeholder descriptions that do not report visible details", () => {
    expect(() => validateImageAnalysis({
      ...analysis,
      imageDescriptions: [{ imageId: "image-1", description: "첫 번째 수련 장면" }],
    }, input)).toThrow("구체적인 사진 설명")
  })
})
