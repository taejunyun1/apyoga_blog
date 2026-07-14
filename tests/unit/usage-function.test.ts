import { describe, expect, it } from "vitest"
import { onRequest, onRequestGet } from "../../functions/api/usage"
import type { ContentEnv, PagesContext } from "../../functions/lib/env"
import { fakeUsageDatabase } from "./auth-env-fixtures"

function usageEnv(summary?: Record<string, unknown>): ContentEnv {
  return {
    AUTH_USERNAME: "studio-user",
    AUTH_PASSWORD_HASH: "unused",
    SESSION_SECRET: "unused",
    AUTH_RATE_LIMIT: {
      get: async () => null,
      put: async () => undefined,
      delete: async () => undefined,
    },
    AUTH_DB: fakeUsageDatabase({ summary }),
    OPENAI_API_KEY: "test-key",
    OPENAI_INPUT_KRW_PER_MILLION: "1522.44",
    OPENAI_CACHED_INPUT_KRW_PER_MILLION: "152.244",
    OPENAI_OUTPUT_KRW_PER_MILLION: "9134.64",
  }
}

function context(request: Request, env: ContentEnv): PagesContext<ContentEnv> {
  return { request, env, next: async () => new Response(null, { status: 404 }) }
}

describe("usage Pages Function", () => {
  it("returns the protected project aggregate for a same-origin GET", async () => {
    const response = await onRequestGet(context(
      new Request("https://studio.example/api/usage", { headers: { Origin: "https://studio.example" } }),
      usageEnv({
        input_tokens: 120,
        cached_input_tokens: 20,
        output_tokens: 80,
        estimated_krw: 1,
        request_count: 1,
      }),
    ))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      inputTokens: 120,
      cachedInputTokens: 20,
      outputTokens: 80,
      totalTokens: 200,
      estimatedKrw: 1,
      requestCount: 1,
    })
  })

  it("does not expose malformed aggregate rows", async () => {
    const response = await onRequestGet(context(
      new Request("https://studio.example/api/usage", { headers: { Origin: "https://studio.example" } }),
      usageEnv({
        input_tokens: "120",
        cached_input_tokens: 20,
        output_tokens: 80,
        estimated_krw: 1,
        request_count: 1,
      }),
    ))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ message: "AI 사용량을 불러오지 못했어요." })
  })

  it("returns 405 for non-GET requests", async () => {
    const response = await onRequest(context(
      new Request("https://studio.example/api/usage", { method: "POST", headers: { Origin: "https://studio.example" } }),
      usageEnv(),
    ))

    expect(response.status).toBe(405)
    expect(response.headers.get("Allow")).toBe("GET")
  })
})
