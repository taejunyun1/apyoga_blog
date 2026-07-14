import { describe, expect, it, vi } from "vitest"
import {
  handleImageAnalysis,
  MAX_IMAGE_ANALYSIS_BODY_BYTES,
} from "../../functions/api/content/analyze-images"
import type { ContentEnv } from "../../functions/lib/env"
import { OpenAIImageAnalysisError } from "../../functions/lib/openai-image-analysis"
import { fakeAuthDatabase, fakeUsageDatabase } from "./auth-env-fixtures"

const env: ContentEnv = {
  AUTH_USERNAME: "studio-user",
  AUTH_PASSWORD_HASH: "unused",
  SESSION_SECRET: "unused",
  AUTH_RATE_LIMIT: {
    get: async () => null,
    put: async () => undefined,
    delete: async () => undefined,
  },
  AUTH_DB: fakeAuthDatabase(),
  OPENAI_API_KEY: "test-key",
  OPENAI_INPUT_KRW_PER_MILLION: "1522.44",
  OPENAI_CACHED_INPUT_KRW_PER_MILLION: "152.244",
  OPENAI_OUTPUT_KRW_PER_MILLION: "9134.64",
}

const responseUsage = { inputTokens: 120, cachedInputTokens: 20, outputTokens: 80 }

function openAIResult<T>(data: T) {
  return { data, responseUsage }
}

const validBody = {
  draftId: "draft-1",
  memo: "햇살이 들어오는 공간에서 호흡을 살핀 수련",
  mustInclude: "호흡",
  avoid: "치료, 완치",
  writingMode: "body-sense",
  naverTone: "plain",
  instagramTone: "emotional",
  images: [{
    id: "image-1",
    isCover: true,
    sortOrder: 0,
    dataUrl: "data:image/jpeg;base64,ZmFrZS1waXhlbHM=",
  }],
}

const validAnalysis = {
  classSummary: "햇살이 비치는 요가원 수련",
  overallMood: "따뜻한 자연광",
  bodyFocus: ["전신"],
  visualKeywords: ["자연광", "매트"],
  imageDescriptions: [{ imageId: "image-1", description: "큰 창 옆 매트 위에서 팔을 뻗은 장면" }],
  recommendedCoverImageId: "image-1",
  recommendedImageOrder: ["image-1"],
  uncertainClaims: [],
  seasonalContext: "",
  userMemoSummary: "호흡을 살핀 수련",
}

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request("https://studio.example/api/content/analyze-images", {
    method: "POST",
    headers: {
      Origin: "https://studio.example",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

describe("image analysis Pages Function", () => {
  it("accepts only bounded same-origin JPEG data URLs and returns the structured brief", async () => {
    const database = fakeUsageDatabase()
    const analyze = vi.fn().mockResolvedValue(openAIResult(validAnalysis))
    const response = await handleImageAnalysis(request(validBody), { ...env, AUTH_DB: database }, {
      analyze,
      safetyIdentifier: vi.fn().mockResolvedValue("hashed-user"),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      source: "openai",
      data: validAnalysis,
      usage: {
        inputTokens: 120,
        cachedInputTokens: 20,
        outputTokens: 80,
        totalTokens: 200,
        estimatedKrw: expect.any(Number),
        requestCount: 1,
      },
    })
    expect(analyze).toHaveBeenCalledWith(
      expect.objectContaining({ memo: validBody.memo }),
      expect.objectContaining({ OPENAI_API_KEY: "test-key" }),
      expect.objectContaining({ safetyIdentifier: "hashed-user" }),
    )
    expect(database.lastBoundValues).toEqual([
      "draft-1", "image-analysis", "gpt-5.6-luna", 120, 20, 80, expect.any(Number), expect.any(String),
    ])
  })

  it.each([
    ["cross origin", request(validBody, { Origin: "https://attacker.example" }), 403],
    ["non-image data", request({ ...validBody, images: [{ ...validBody.images[0], dataUrl: "data:text/plain;base64,ZmFrZQ==" }] }), 400],
    ["extra private metadata", request({ ...validBody, images: [{ ...validBody.images[0], editedBlobId: "private" }] }), 400],
    ["duplicate ids", request({ ...validBody, images: [validBody.images[0], { ...validBody.images[0], sortOrder: 1 }] }), 400],
    ["declared too large", request(validBody, { "Content-Length": String(MAX_IMAGE_ANALYSIS_BODY_BYTES + 1) }), 413],
  ])("rejects %s", async (_label, incoming, status) => {
    expect((await handleImageAnalysis(incoming, env)).status).toBe(status)
  })

  it("retries one retryable OpenAI failure and never returns a generic local brief", async () => {
    const analyze = vi.fn()
      .mockRejectedValueOnce(new OpenAIImageAnalysisError("retry", true))
      .mockResolvedValueOnce(openAIResult(validAnalysis))
    const response = await handleImageAnalysis(request(validBody), env, {
      analyze,
      safetyIdentifier: vi.fn().mockResolvedValue("hashed-user"),
    })

    expect(response.status).toBe(200)
    expect(analyze).toHaveBeenCalledTimes(2)
  })
})
