import { describe, expect, it, vi } from "vitest"
import {
  OpenAIContentError,
  requestOpenAIRewrite,
  validateRewriteContent,
} from "../../functions/lib/openai-content"
import type { RewriteContentInput } from "../../functions/lib/content-types"

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
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ section, text }) }] }],
  })
}

describe("OpenAI rewrite content", () => {
  it("requests a strict rewrite schema without storing the response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completed("호흡을 살피며 수련을 시작했습니다."))
    const result = await requestOpenAIRewrite(input, { OPENAI_API_KEY: "test-key" }, {
      fetcher,
      safetyIdentifier: "hashed-user",
    })

    expect(result).toEqual({ section: "intro", text: "호흡을 살피며 수련을 시작했습니다." })
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

  it("requires every rewritten hashtag token to start with #", () => {
    expect(() => validateRewriteContent({ section: "hashtags", text: "#요가 잘못된태그" }, {
      ...input,
      channel: "instagram",
      section: "hashtags",
      currentText: "#에이피요가 #요가기록",
    })).toThrow("해시태그")
  })
})
