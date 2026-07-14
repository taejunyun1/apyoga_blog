import { describe, expect, it } from "vitest"
import type { ContentEnv } from "../../functions/lib/env"
import {
  estimateUsageKrw,
  parseOpenAIResponseUsage,
  projectUsageSummary,
  recordUsage,
} from "../../functions/lib/usage"
import { fakeUsageDatabase } from "./auth-env-fixtures"

function usageEnv(database: ReturnType<typeof fakeUsageDatabase>): ContentEnv {
  return {
    AUTH_USERNAME: "studio-user",
    AUTH_PASSWORD_HASH: "unused",
    SESSION_SECRET: "unused",
    AUTH_RATE_LIMIT: {
      get: async () => null,
      put: async () => undefined,
      delete: async () => undefined,
    },
    AUTH_DB: database,
    OPENAI_API_KEY: "test-key",
    OPENAI_INPUT_KRW_PER_MILLION: "1522.44",
    OPENAI_CACHED_INPUT_KRW_PER_MILLION: "152.244",
    OPENAI_OUTPUT_KRW_PER_MILLION: "9134.64",
  }
}

describe("usage ledger", () => {
  it("calculates one request estimate with cached input pricing", async () => {
    const usage = parseOpenAIResponseUsage({
      usage: {
        input_tokens: 1_000_000,
        output_tokens: 500_000,
        input_tokens_details: { cached_tokens: 200_000 },
      },
    })
    const estimate = estimateUsageKrw(usage, {
      inputKrwPerMillion: 1522.44,
      cachedInputKrwPerMillion: 152.244,
      outputKrwPerMillion: 9134.64,
    })

    expect(estimate).toBe(5_816)
  })

  it("records no content fields and summarizes project totals", async () => {
    const database = fakeUsageDatabase({
      summary: {
        input_tokens: 13,
        cached_input_tokens: 2,
        output_tokens: 8,
        estimated_krw: 4,
        request_count: 2,
      },
    })
    await recordUsage(usageEnv(database), {
      draftId: "draft-1",
      requestKind: "naver",
      model: "gpt-5.6-luna",
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 4,
      estimatedKrw: 2,
      createdAt: "2026-07-14T00:00:00.000Z",
    })

    expect(database.lastQuery).toContain("INSERT INTO api_usage")
    expect(database.lastBoundValues).toEqual([
      "draft-1",
      "naver",
      "gpt-5.6-luna",
      10,
      2,
      4,
      2,
      "2026-07-14T00:00:00.000Z",
    ])
    expect(database.lastQuery).not.toMatch(/content|prompt|output_text|response_body/i)
    await expect(projectUsageSummary(usageEnv(database))).resolves.toEqual({
      inputTokens: 13,
      cachedInputTokens: 2,
      outputTokens: 8,
      totalTokens: 21,
      estimatedKrw: 4,
      requestCount: 2,
    })
  })

  it("returns zero totals when the ledger has no rows", async () => {
    await expect(projectUsageSummary(usageEnv(fakeUsageDatabase()))).resolves.toEqual({
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedKrw: 0,
      requestCount: 0,
    })
  })

  it("rejects a ledger write that D1 did not persist", async () => {
    const database = fakeUsageDatabase({ runSuccess: false })

    await expect(recordUsage(usageEnv(database), {
      draftId: "draft-1",
      requestKind: "naver",
      model: "gpt-5.6-luna",
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 4,
      estimatedKrw: 2,
      createdAt: "2026-07-14T00:00:00.000Z",
    })).rejects.toThrow("AI 사용량 저장")
  })

  it.each([
    [{ usage: { input_tokens: -1, output_tokens: 1 } }],
    [{ usage: { input_tokens: 1 } }],
    [{ usage: { input_tokens: 1, output_tokens: "1" } }],
    [{ usage: { input_tokens: 1, output_tokens: 1, input_tokens_details: { cached_tokens: 2 } } }],
  ])("rejects invalid upstream usage", (payload) => {
    expect(() => parseOpenAIResponseUsage(payload)).toThrow("AI 사용량 형식")
  })

  it.each([
    { inputKrwPerMillion: -1, cachedInputKrwPerMillion: 0, outputKrwPerMillion: 0 },
    { inputKrwPerMillion: Number.NaN, cachedInputKrwPerMillion: 0, outputKrwPerMillion: 0 },
  ])("rejects invalid price values", (rates) => {
    expect(() => estimateUsageKrw({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }, rates))
      .toThrow("AI 사용량 가격 형식")
  })
})
