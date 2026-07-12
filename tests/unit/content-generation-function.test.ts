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

const env: ContentEnv = {
  AUTH_USERNAME: "studio-user",
  AUTH_PASSWORD_HASH: "unused-by-content-endpoint",
  SESSION_SECRET: "unused-by-content-endpoint",
  AUTH_RATE_LIMIT: {
    get: async () => null,
    put: async () => undefined,
    delete: async () => undefined,
  },
  OPENAI_API_KEY: "test-key",
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
): Request {
  return new Request("https://studio.example/api/content/generate", {
    method: "POST",
    headers: {
      Origin: "https://studio.example",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ channel, input }),
  })
}

function dependencies(generate = vi.fn().mockResolvedValue(validNaver())) {
  return {
    generate,
    safetyIdentifier: vi.fn().mockResolvedValue("hashed-user"),
  }
}

describe("content generation Pages Function", () => {
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
    const generate = vi.fn().mockResolvedValue(validNaver())
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
    const generate = vi.fn().mockResolvedValue(validNaver())

    const response = await handleContentGeneration(
      requestFor("naver", validInput()),
      { ...env, OPENAI_API_KEY: "" },
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
      .mockResolvedValueOnce(validNaver())
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
