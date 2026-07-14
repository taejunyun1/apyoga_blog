import { describe, expect, it, vi } from "vitest"
import * as openAIContent from "../../functions/lib/openai-content"
import {
  OpenAIContentError,
  requestOpenAIRewrite,
  validateRewriteContent,
} from "../../functions/lib/openai-content"
import type { RewriteContentInput } from "../../functions/lib/content-types"

type TitleBodyInput = {
  kind: "naver-title-body"
  instruction: string
  currentTitle: string
  currentBody: string
  memo: string
  photoContext: string
  avoid: string
  tone: "plain" | "emotional" | "deep"
}

type TitleBodyOutput = { title: string; body: string }

const titleBodyApi = openAIContent as typeof openAIContent & {
  requestOpenAINaverTitleAndBodyRewrite: (
    input: TitleBodyInput,
    env: { OPENAI_API_KEY: string },
    options: { fetcher?: typeof fetch; safetyIdentifier: string; retryInstruction?: string },
  ) => Promise<TitleBodyOutput>
  validateNaverTitleAndBodyRewrite: (value: unknown, input: TitleBodyInput) => TitleBodyOutput
}

const input: RewriteContentInput = {
  channel: "naver",
  section: "intro",
  instruction: "감성 줄이기",
  currentText: "조용한 감정이 오래 머무는 저녁이었습니다.",
  memo: "어깨와 흉곽을 살핀 수련",
  avoid: "치료, 완치",
  tone: "plain",
}

function completed(text: string, section = "intro") {
  return Response.json({
    status: "completed",
    usage: {
      input_tokens: 120,
      output_tokens: 80,
      input_tokens_details: { cached_tokens: 20 },
    },
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ section, text }) }] }],
  })
}

const titleBodyInput: TitleBodyInput = {
  kind: "naver-title-body",
  instruction: "최근 글과 다르게",
  currentTitle: "호흡으로 돌아본 일요일 수련",
  currentBody: "기존 본문 ".repeat(100),
  memo: "어깨와 흉곽의 감각을 살핀 일요일 수련",
  photoContext: "전체 분위기: 따뜻하고 고요함\n사진 설명: 우드 바닥과 싱잉볼, 함께 수련하는 공간",
  avoid: "치료, 완치",
  tone: "emotional",
}

function completedTitleBody(title: string, body: string) {
  return Response.json({
    status: "completed",
    usage: {
      input_tokens: 120,
      output_tokens: 80,
      input_tokens_details: { cached_tokens: 20 },
    },
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ title, body }) }] }],
  })
}

describe("OpenAI rewrite content", () => {
  it("requests one strict title and body rewrite grounded in the photo context", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completedTitleBody(
      "고요한 공간에서 이어진 일요일의 호흡",
      "새로운 감성 본문 ".repeat(100),
    ))

    expect(titleBodyApi.requestOpenAINaverTitleAndBodyRewrite).toBeTypeOf("function")
    const result = await titleBodyApi.requestOpenAINaverTitleAndBodyRewrite(titleBodyInput, { OPENAI_API_KEY: "test-key" }, {
      fetcher,
      safetyIdentifier: "hashed-user",
    })

    expect(result).toEqual({
      data: {
        title: "고요한 공간에서 이어진 일요일의 호흡",
        body: "새로운 감성 본문 ".repeat(100).trim(),
      },
      responseUsage: { inputTokens: 120, cachedInputTokens: 20, outputTokens: 80 },
    })
    const init = fetcher.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({ store: false, safety_identifier: "hashed-user" })
    expect(body.instructions).toContain(titleBodyInput.photoContext)
    expect(body.text.format).toMatchObject({ type: "json_schema", name: "rewrite_naver_title_body", strict: true })
  })

  it.each([
    ["unchanged title", { title: titleBodyInput.currentTitle, body: "새 본문 ".repeat(100) }, "다른 제목"],
    ["unchanged body", { title: "새 제목", body: titleBodyInput.currentBody }, "다른 본문"],
    ["short body", { title: "새 제목", body: "짧은 본문" }, "500자"],
    ["forbidden expression", { title: "치료를 약속하는 제목", body: "새 본문 ".repeat(110) }, "금지 표현"],
    ["direct photo narration", { title: "새 제목", body: `사진 속 장면은 ${"호흡 ".repeat(180)}` }, "사진 장면"],
  ])("rejects paired rewrites with %s", (_label, value, message) => {
    expect(titleBodyApi.validateNaverTitleAndBodyRewrite).toBeTypeOf("function")
    expect(() => titleBodyApi.validateNaverTitleAndBodyRewrite(value, titleBodyInput)).toThrow(message)
  })

  it("requests a strict rewrite schema without storing the response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completed("호흡을 살피며 수련을 시작했습니다."))
    const result = await requestOpenAIRewrite(input, { OPENAI_API_KEY: "test-key" }, {
      fetcher,
      safetyIdentifier: "hashed-user",
    })

    expect(result).toEqual({
      data: { section: "intro", text: "호흡을 살피며 수련을 시작했습니다." },
      responseUsage: { inputTokens: 120, cachedInputTokens: 20, outputTokens: 80 },
    })
    const init = fetcher.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({ store: false, safety_identifier: "hashed-user" })
    expect(body.text.format).toMatchObject({ type: "json_schema", name: "rewrite_content", strict: true })
  })

  it.each([
    ["a mismatched section", { section: "title", text: "새 문구" }],
    ["unchanged text", { section: "intro", text: input.currentText }],
    ["a forbidden expression", { section: "intro", text: "치료를 위한 수련입니다." }],
    ["a direct medical claim", { section: "intro", text: "통증이 완치됩니다." }],
  ])("rejects %s", (_label, value) => {
    expect(() => validateRewriteContent(value, input)).toThrow(OpenAIContentError)
  })

  it("requires at least 500 characters for a Naver body", () => {
    expect(() => validateRewriteContent({ section: "body", text: "짧은 본문" }, {
      ...input,
      section: "body",
      currentText: "기존 본문 ".repeat(80),
    })).toThrow("500자")
  })

  it("rejects a rewritten body that directly narrates the photo", () => {
    const text = `${"호흡과 따뜻한 빛의 여운을 차분히 이어갑니다. ".repeat(25)} 사진 속 발과 하반신이 보입니다.`

    expect(() => validateRewriteContent({ section: "body", text }, {
      ...input,
      section: "body",
      instruction: "사진 분위기 더하기",
      currentText: "기존 본문 ".repeat(80),
    })).toThrow("사진 장면을 나열하지 않고 감성적인 발행 문장으로 작성해 주세요.")
  })

  it("requires every rewritten hashtag token to start with #", () => {
    expect(() => validateRewriteContent({ section: "hashtags", text: "#요가 잘못된태그" }, {
      ...input,
      channel: "instagram",
      section: "hashtags",
      currentText: "#에이피요가 #요가기록",
    })).toThrow("해시태그")
  })
})
