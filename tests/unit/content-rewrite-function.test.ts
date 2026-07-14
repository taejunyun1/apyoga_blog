import { describe, expect, it, vi } from "vitest"
import { handleContentRewrite } from "../../functions/api/content/rewrite"
import type { RewriteContentInput } from "../../functions/lib/content-types"
import type { ContentEnv } from "../../functions/lib/env"
import { OpenAIContentError } from "../../functions/lib/openai-content"
import { fakeAuthDatabase } from "./auth-env-fixtures"

const env: ContentEnv = {
  AUTH_USERNAME: "studio-user",
  AUTH_PASSWORD_HASH: "unused-by-content-endpoint",
  SESSION_SECRET: "unused-by-content-endpoint",
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

function validInput(): RewriteContentInput {
  return {
    channel: "naver",
    section: "intro",
    instruction: "감성 줄이기",
    currentText: "조용한 감정이 오래 머무는 저녁이었습니다.",
    memo: "어깨와 흉곽을 살핀 수련",
    avoid: "치료, 완치",
    tone: "plain",
  }
}

function validTitleBodyInput() {
  return {
    kind: "naver-title-body" as const,
    instruction: "최근 글과 다르게",
    currentTitle: "호흡으로 돌아본 일요일 수련",
    currentBody: "기존 본문 ".repeat(100),
    memo: "어깨와 흉곽을 살핀 수련",
    photoContext: "전체 분위기: 따뜻하고 고요함\n사진 설명: 우드 바닥과 싱잉볼",
    avoid: "치료, 완치",
    tone: "emotional" as const,
  }
}

function requestFor(input: unknown, headers: HeadersInit = {}, draftId = "draft-1"): Request {
  return new Request("https://studio.example/api/content/rewrite", {
    method: "POST",
    headers: {
      Origin: "https://studio.example",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ draftId, ...(input as object) }),
  })
}

function dependencies(rewrite = vi.fn().mockResolvedValue(openAIResult({
  section: "intro",
  text: "호흡을 살피며 시작했습니다.",
})), rewriteTitleAndBody = vi.fn().mockResolvedValue(openAIResult({
  title: "새 제목",
  body: "새 본문 ".repeat(100),
}))) {
  return {
    rewrite,
    rewriteTitleAndBody,
    safetyIdentifier: vi.fn().mockResolvedValue("hashed-user"),
  }
}

describe("content rewrite Pages Function", () => {
  it("routes a valid title-body request to one paired rewrite dependency", async () => {
    const rewriteTitleAndBody = vi.fn().mockResolvedValue(openAIResult({
      title: "고요한 공간에서 이어진 일요일의 호흡",
      body: "새로운 감성 본문 ".repeat(100),
    }))
    const response = await handleContentRewrite(requestFor(validTitleBodyInput()), env, {
      ...dependencies(),
      rewriteTitleAndBody,
    } as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      source: "openai",
      data: {
        title: "고요한 공간에서 이어진 일요일의 호흡",
        body: "새로운 감성 본문 ".repeat(100),
      },
      usage: {
        inputTokens: 120,
        cachedInputTokens: 20,
        outputTokens: 80,
        totalTokens: 200,
        estimatedKrw: expect.any(Number),
        requestCount: 1,
      },
    })
    expect(rewriteTitleAndBody).toHaveBeenCalledOnce()
  })

  it("rejects cross-origin, non-JSON, and oversized requests", async () => {
    const crossOrigin = requestFor(validInput(), { Origin: "https://attacker.example" })
    expect((await handleContentRewrite(crossOrigin, env, dependencies())).status).toBe(403)

    const nonJson = new Request("https://studio.example/api/content/rewrite", {
      method: "POST",
      headers: { Origin: "https://studio.example", "Content-Type": "text/plain" },
      body: JSON.stringify(validInput()),
    })
    expect((await handleContentRewrite(nonJson, env, dependencies())).status).toBe(403)

    const oversized = requestFor(validInput(), { "Content-Length": "32769" })
    expect((await handleContentRewrite(oversized, env, dependencies())).status).toBe(413)
  })

  it("measures the actual UTF-8 body when Content-Length is unavailable", async () => {
    const response = await handleContentRewrite(
      requestFor({ ...validInput(), memo: "가".repeat(11_000) }),
      env,
      dependencies(),
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ message: "입력 내용이 너무 길어요." })
  })

  it("rejects an invalid channel-section pair", async () => {
    const rewrite = vi.fn()
    const response = await handleContentRewrite(
      requestFor({ ...validInput(), channel: "naver", section: "hook" }),
      env,
      dependencies(rewrite),
    )
    expect(response.status).toBe(400)
    expect(rewrite).not.toHaveBeenCalled()
  })

  it.each([
    ["an empty current text", { ...validInput(), currentText: "" }],
    ["a current text over 12,000 characters", { ...validInput(), currentText: "a".repeat(12_001) }],
    ["a memo over 4,000 characters", { ...validInput(), memo: "가".repeat(4_001) }],
    ["an instruction over 100 characters", { ...validInput(), instruction: "가".repeat(101) }],
    ["an avoid list over 500 characters", { ...validInput(), avoid: "가".repeat(501) }],
    ["an unknown request field", { ...validInput(), apiKey: "must-not-be-forwarded" }],
    ["an unsupported tone", { ...validInput(), tone: "casual" }],
  ])("rejects %s", async (_label, input) => {
    const rewrite = vi.fn()
    const response = await handleContentRewrite(requestFor(input), env, dependencies(rewrite))
    expect(response.status).toBe(400)
    expect(rewrite).not.toHaveBeenCalled()
  })

  it("fails closed when OPENAI_API_KEY is missing", async () => {
    const rewrite = vi.fn()
    const response = await handleContentRewrite(
      requestFor(validInput()),
      { ...env, OPENAI_API_KEY: "" },
      dependencies(rewrite),
    )
    expect(response.status).toBe(500)
    expect(rewrite).not.toHaveBeenCalled()
  })

  it("returns only source and rewritten data", async () => {
    const rewrite = vi.fn().mockResolvedValue(openAIResult({
      section: "intro",
      text: "호흡을 살피며 시작했습니다.",
      internal: "must-not-be-exposed",
    }))
    const response = await handleContentRewrite(requestFor(validInput()), env, dependencies(rewrite))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      source: "openai",
      data: { section: "intro", text: "호흡을 살피며 시작했습니다." },
      usage: {
        inputTokens: 120,
        cachedInputTokens: 20,
        outputTokens: 80,
        totalTokens: 200,
        estimatedKrw: expect.any(Number),
        requestCount: 1,
      },
    })
  })

  it("retries one retryable validation failure and returns the second rewrite", async () => {
    const rewrite = vi.fn()
      .mockRejectedValueOnce(new OpenAIContentError("invalid", true))
      .mockResolvedValueOnce(openAIResult({ section: "intro", text: "두 번째 재작성 문구" }))
    const response = await handleContentRewrite(requestFor(validInput()), env, dependencies(rewrite))
    expect(response.status).toBe(200)
    expect(rewrite).toHaveBeenCalledTimes(2)
    expect(rewrite.mock.calls[1][2]).toMatchObject({
      retryInstruction: "이전 결과의 오류를 수정하고 모든 재작성 제약을 충족하세요.",
    })
  })

  it("returns 502 after two retryable failures without exposing upstream details", async () => {
    const rewrite = vi.fn().mockRejectedValue(new OpenAIContentError("upstream body: secret", true))
    const response = await handleContentRewrite(requestFor(validInput()), env, dependencies(rewrite))
    expect(response.status).toBe(502)
    expect(rewrite).toHaveBeenCalledTimes(2)
    expect(await response.text()).not.toContain("upstream body: secret")
    expect(response.headers.get("Cache-Control")).toBe("no-store")
  })

  it("does not retry a non-retryable OpenAI error or expose its details", async () => {
    const rewrite = vi.fn().mockRejectedValue(new OpenAIContentError("bad request contained test-key", false))
    const response = await handleContentRewrite(requestFor(validInput()), env, dependencies(rewrite))
    expect(response.status).toBe(502)
    expect(rewrite).toHaveBeenCalledOnce()
    expect(await response.text()).not.toContain("test-key")
  })
})
