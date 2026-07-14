import { describe, expect, it, vi } from "vitest"
import {
  handleContentGeneration,
  hashedSafetyIdentifier,
} from "../../functions/api/content/generate"
import type {
  GenerateContentInput,
  GeneratedNaver,
} from "../../functions/lib/content-types"
import type { ContentEnv } from "../../functions/lib/env"
import { OpenAIContentError } from "../../functions/lib/openai-content"
import { fakeAuthDatabase, fakeUsageDatabase } from "./auth-env-fixtures"

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

function validInput(): GenerateContentInput {
  return {
    memo: "어깨와 흉곽을 천천히 연 수련",
    mustInclude: "호흡",
    avoid: "치료, 과장",
    writingMode: "body-sense",
    tone: "plain",
    brief: {
      classSummary: "차분한 저녁 수련",
      overallMood: "차분함",
      bodyFocus: ["어깨", "흉곽"],
      imageDescriptions: [{ imageId: "image-1", description: "첫 번째 수련 장면" }],
      recommendedCoverImageId: "image-1",
      recommendedImageOrder: ["image-1"],
    },
  }
}

function validNaver(): GeneratedNaver {
  return {
    titles: ["천천히 여는 저녁", "몸의 감각을 듣는 시간", "차분하게 이어 간 수련"],
    introOptions: ["오늘의 몸을 살폈습니다.", "작은 움직임에서 시작했습니다.", "편안한 리듬을 찾았습니다."],
    body: "호흡을 따라 어깨와 흉곽의 감각을 차분하게 살폈습니다. ".repeat(12),
    imagePlacements: [{ imageId: "image-1", afterParagraph: 2, caption: "수련 장면" }],
    hashtags: ["#에이피요가", "#요가기록"],
    classInfo: "수업 정보는 게시 전에 확인해 주세요.",
  }
}

function requestFor(
  channel: unknown,
  input: unknown,
  headers: HeadersInit = {},
  draftId = "draft-1",
): Request {
  return new Request("https://studio.example/api/content/generate", {
    method: "POST",
    headers: {
      Origin: "https://studio.example",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ draftId, channel, input }),
  })
}

function dependencies(generate = vi.fn().mockResolvedValue(openAIResult(validNaver()))) {
  return {
    generate,
    safetyIdentifier: vi.fn().mockResolvedValue("hashed-user"),
  }
}

describe("content generation Pages Function", () => {
  it("requires a bounded draft id, records Naver usage, and returns the persisted request total", async () => {
    const database = fakeUsageDatabase()
    const response = await handleContentGeneration(
      requestFor("naver", validInput()),
      { ...env, AUTH_DB: database },
      dependencies(),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      channel: "naver",
      source: "openai",
      data: validNaver(),
      usage: {
        inputTokens: 120,
        cachedInputTokens: 20,
        outputTokens: 80,
        totalTokens: 200,
        estimatedKrw: expect.any(Number),
        requestCount: 1,
      },
    })
    expect(database.lastBoundValues).toEqual([
      "draft-1", "naver", "gpt-5.6-luna", 120, 20, 80, expect.any(Number), expect.any(String),
    ])

    const missingDraftId = await handleContentGeneration(
      requestFor("naver", validInput(), {}, ""),
      env,
      dependencies(),
    )
    expect(missingDraftId.status).toBe(400)
  })

  it("rejects cross-origin and oversized content requests", async () => {
    const crossOrigin = requestFor("naver", validInput(), { Origin: "https://attacker.example" })
    expect((await handleContentGeneration(crossOrigin, env, dependencies())).status).toBe(403)

    const oversized = requestFor("naver", validInput(), { "Content-Length": "32769" })
    expect((await handleContentGeneration(oversized, env, dependencies())).status).toBe(413)
  })

  it("measures the actual UTF-8 body when Content-Length is unavailable", async () => {
    const request = requestFor("naver", { ...validInput(), memo: "가".repeat(11_000) })

    const response = await handleContentGeneration(request, env, dependencies())

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ message: "입력 내용이 너무 길어요." })
  })

  it("cancels a falsely small streamed body as soon as byte 32,769 is observed", async () => {
    const chunks = [
      new Uint8Array(32_768),
      new Uint8Array([0x7b]),
      new TextEncoder().encode("must-not-be-pulled"),
    ]
    let index = 0
    let bytesPulled = 0
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index]
        index += 1
        if (!chunk) {
          controller.close()
          return
        }
        bytesPulled += chunk.byteLength
        controller.enqueue(chunk)
      },
      cancel() {
        cancelled = true
      },
    }, { highWaterMark: 0 })
    const request = new Request("https://studio.example/api/content/generate", {
      method: "POST",
      headers: {
        Origin: "https://studio.example",
        "Content-Type": "application/json",
        "Content-Length": "1",
      },
      body,
      duplex: "half",
    } as RequestInit)

    const response = await handleContentGeneration(request, env, dependencies())

    expect(response.status).toBe(413)
    expect(cancelled).toBe(true)
    expect(bytesPulled).toBe(32_769)
  })

  it.each([
    ["a null body", null],
    ["invalid UTF-8", new Uint8Array([0xff])],
  ])("rejects %s with the generic request response", async (_label, body) => {
    const request = new Request("https://studio.example/api/content/generate", {
      method: "POST",
      headers: { Origin: "https://studio.example", "Content-Type": "application/json" },
      body,
    })

    const response = await handleContentGeneration(request, env, dependencies())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ message: "요청을 확인해 주세요." })
  })

  it.each([
    ["unsupported channel", { channel: "youtube", input: validInput() }],
    ["memo over 4,000 characters", { channel: "naver", input: { ...validInput(), memo: "가".repeat(4_001) } }],
    ["must-include over 500 characters", { channel: "naver", input: { ...validInput(), mustInclude: "가".repeat(501) } }],
    ["avoid over 500 characters", { channel: "naver", input: { ...validInput(), avoid: "가".repeat(501) } }],
    ["more than ten body focuses", {
      channel: "naver",
      input: { ...validInput(), brief: { ...validInput().brief, bodyFocus: Array.from({ length: 11 }, (_, index) => `부위-${index}`) } },
    }],
    ["more than ten image descriptions", {
      channel: "naver",
      input: {
        ...validInput(),
        brief: {
          ...validInput().brief,
          imageDescriptions: Array.from({ length: 11 }, (_, index) => ({ imageId: `image-${index}`, description: "수련 장면" })),
        },
      },
    }],
    ["unknown photo binary field", {
      channel: "naver",
      input: {
        ...validInput(),
        brief: {
          ...validInput().brief,
          imageDescriptions: [{ imageId: "image-1", description: "수련 장면", editedBlobId: "secret-photo-blob" }],
        },
      },
    }],
  ])("rejects invalid input: %s", async (_label, body) => {
    const generate = vi.fn().mockResolvedValue(openAIResult(validNaver()))
    const request = requestFor(body.channel, body.input)

    const response = await handleContentGeneration(request, env, dependencies(generate))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ message: "요청을 확인해 주세요." })
    expect(generate).not.toHaveBeenCalled()
  })

  it("rejects malformed JSON with a generic request response", async () => {
    const request = new Request("https://studio.example/api/content/generate", {
      method: "POST",
      headers: { Origin: "https://studio.example", "Content-Type": "application/json" },
      body: "{",
    })

    const response = await handleContentGeneration(request, env, dependencies())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ message: "요청을 확인해 주세요." })
  })

  it("fails closed before generation when the API key binding is missing", async () => {
    const generate = vi.fn().mockResolvedValue(openAIResult(validNaver()))

    const response = await handleContentGeneration(
      requestFor("naver", validInput()),
      { ...env, OPENAI_API_KEY: "" },
      dependencies(generate),
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ message: "AI 설정을 확인해 주세요." })
    expect(generate).not.toHaveBeenCalled()
  })

  it.each([
    ["missing input pricing", { OPENAI_INPUT_KRW_PER_MILLION: undefined }],
    ["blank cached-input pricing", { OPENAI_CACHED_INPUT_KRW_PER_MILLION: " " }],
    ["malformed output pricing", { OPENAI_OUTPUT_KRW_PER_MILLION: "not-a-number" }],
  ])("fails closed before generation when %s is configured", async (_label, overrides) => {
    const generate = vi.fn().mockResolvedValue(openAIResult(validNaver()))

    const response = await handleContentGeneration(
      requestFor("naver", validInput()),
      { ...env, ...overrides },
      dependencies(generate),
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ message: "AI 설정을 확인해 주세요." })
    expect(generate).not.toHaveBeenCalled()
  })

  it("hashes the account into a stable truncated safety identifier", async () => {
    const identifier = await hashedSafetyIdentifier("studio-user")

    expect(identifier).toBe("3cbfdc58b56fdb7d161a5af371b5b638")
    expect(identifier).toMatch(/^[a-f0-9]{32}$/)
    expect(identifier).not.toContain("studio-user")
  })

  it("retries a short Naver result once and returns the second result", async () => {
    const generate = vi.fn()
      .mockRejectedValueOnce(new OpenAIContentError("네이버 본문은 500자 이상이어야 해요.", true))
      .mockResolvedValueOnce(openAIResult(validNaver()))
    const safetyIdentifier = vi.fn().mockResolvedValue("hashed-user")

    const response = await handleContentGeneration(
      requestFor("naver", validInput()),
      env,
      { generate, safetyIdentifier },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(generate).toHaveBeenCalledTimes(2)
    expect(generate.mock.calls[0][3]).toEqual({
      safetyIdentifier: "hashed-user",
      retryInstruction: undefined,
    })
    expect(generate.mock.calls[1][3]).toEqual({
      safetyIdentifier: "hashed-user",
      retryInstruction: "이전 결과의 오류를 수정하고 모든 제약을 충족하세요.",
    })
    await expect(response.json()).resolves.toMatchObject({ channel: "naver", source: "openai" })
  })

  it("bounds retryable failures to two generation attempts", async () => {
    const generate = vi.fn().mockRejectedValue(new OpenAIContentError("upstream body: secret", true))

    const response = await handleContentGeneration(
      requestFor("naver", validInput()),
      env,
      dependencies(generate),
    )

    expect(response.status).toBe(502)
    expect(generate).toHaveBeenCalledTimes(2)
    expect(await response.text()).not.toContain("upstream body: secret")
    expect(response.headers.get("Cache-Control")).toBe("no-store")
  })

  it("does not retry an OpenAI authentication error or expose its details", async () => {
    const generate = vi.fn().mockRejectedValue(
      new OpenAIContentError("401 upstream body contained test-key", false),
    )

    const response = await handleContentGeneration(
      requestFor("instagram", validInput()),
      env,
      dependencies(generate),
    )

    expect(response.status).toBe(502)
    expect(generate).toHaveBeenCalledTimes(1)
    await expect(response.json()).resolves.toEqual({ message: "AI 생성이 지연되어 로컬 초안으로 전환합니다." })
  })
})
