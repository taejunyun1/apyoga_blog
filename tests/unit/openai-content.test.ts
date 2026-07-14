import { describe, expect, it, vi } from "vitest"
import {
  OpenAIContentError,
  requestOpenAIContent,
  validateGeneratedContent,
} from "../../functions/lib/openai-content"
import type {
  GenerateContentInput,
  GeneratedInstagram,
  GeneratedNaver,
} from "../../functions/lib/content-types"

const request: GenerateContentInput = {
  memo: "어깨와 흉곽을 천천히 연 수련",
  mustInclude: "호흡",
  avoid: "치료, 과장",
  writingMode: "body-sense",
  tone: "plain",
  brief: {
    classSummary: "차분한 저녁 수련",
    overallMood: "차분함",
    bodyFocus: ["어깨", "흉곽"],
    imageDescriptions: [{ imageId: "image-1", description: "큰 창 옆 매트 위에서 두 팔을 길게 뻗은 장면" }],
    recommendedCoverImageId: "image-1",
    recommendedImageOrder: ["image-1"],
  },
}

function validNaver(): GeneratedNaver {
  const paragraph = "호흡을 따라 어깨와 흉곽의 감각을 차분하게 살피며 큰 창 옆 매트 위에서 두 팔을 길게 뻗었습니다."
  return {
    titles: ["천천히 여는 저녁", "몸의 감각을 듣는 시간", "차분하게 이어 간 수련"],
    introOptions: ["오늘의 몸을 살폈습니다.", "작은 움직임에서 시작했습니다.", "편안한 리듬을 찾았습니다."],
    body: Array.from({ length: 12 }, (_, index) => `${index + 1}번째 기록입니다. ${paragraph}`).join("\n\n"),
    imagePlacements: [{ imageId: "image-1", afterParagraph: 2, caption: "큰 창 옆 매트 위에서 두 팔을 길게 뻗은 장면" }],
    hashtags: ["#에이피요가", "#요가기록"],
    classInfo: "수업 정보는 게시 전에 확인해 주세요.",
  }
}

function validInstagram(): GeneratedInstagram {
  return {
    hookOptions: ["몸의 속도를 듣는 시간", "작은 움직임에서 시작하기", "오늘의 감각을 따라가기"],
    captionLong: "큰 창 옆 매트 위에서 두 팔을 길게 뻗으며 호흡과 어깨의 감각을 천천히 살폈습니다.",
    captionShort: "호흡으로 돌아온 저녁 수련.",
    hashtags: ["#에이피요가", "#요가기록"],
    coverImageId: "image-1",
    imageOrder: ["image-1"],
  }
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

function requestContent(
  channel: "naver" | "instagram",
  response: Response,
) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response)
  return {
    fetcher,
    result: requestOpenAIContent(
      channel,
      request,
      { OPENAI_API_KEY: "test-key" },
      { fetcher, safetyIdentifier: "hashed-user" },
    ),
  }
}

async function expectRetryable(result: Promise<unknown>, message?: string): Promise<void> {
  const error = await result.catch((reason: unknown) => reason)
  expect(error).toBeInstanceOf(OpenAIContentError)
  expect(error).toMatchObject({ retryable: true })
  if (message) expect(error).toMatchObject({ message })
}

describe("OpenAI content client", () => {
  it("returns validated generated content together with completed Responses usage", async () => {
    const { result } = requestContent("naver", completed(validNaver()))

    await expect(result).resolves.toEqual({
      data: validNaver(),
      responseUsage: { inputTokens: 120, cachedInputTokens: 20, outputTokens: 80 },
    })
  })

  it.each([
    ["naver", { ...validNaver(), body: `${validNaver().body} 첫 번째 사진에는 큰 창과 매트가 보입니다.` }],
    ["instagram", { ...validInstagram(), captionLong: `${validInstagram().captionLong} 2번째 사진은 나무 바닥을 보여 줍니다.` }],
    ["naver", { ...validNaver(), body: `${validNaver().body} 사진 속 발과 하반신은 잠시 멈춘 순간을 보여 줍니다.` }],
    ["instagram", { ...validInstagram(), captionLong: `${validInstagram().captionLong} 이미지에는 나무 바닥과 꽃이 보입니다.` }],
  ] as const)("rejects report-style or direct photo narration in %s copy", (channel, content) => {
    expect(() => validateGeneratedContent(channel, content, request))
      .toThrow("사진 장면을 나열하지 않고 감성적인 발행 문장으로 작성해 주세요.")
  })

  it("rejects Naver copy whose body and image caption ignore the analyzed photo", () => {
    const unrelated = {
      ...validNaver(),
      body: "호흡을 따라 어깨와 흉곽의 감각을 차분하게 살폈습니다. ".repeat(20),
      imagePlacements: [{ imageId: "image-1", afterParagraph: 1, caption: "차분한 요가 수련 장면" }],
    }

    expect(() => validateGeneratedContent("naver", unrelated, request)).toThrow("사진 분석 내용")
  })

  it("rejects Instagram copy that contains no concrete visual detail from the photos", () => {
    const unrelated = {
      ...validInstagram(),
      captionLong: "호흡을 따라 몸의 감각을 천천히 살피며 편안한 움직임을 이어 갔습니다.",
    }

    expect(() => validateGeneratedContent("instagram", unrelated, request)).toThrow("사진 분석 내용")
  })

  it("sends a stateless strict Responses request without photo data", async () => {
    const { fetcher, result } = requestContent("naver", completed(validNaver()))

    await result

    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses")
    const init = fetcher.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(init.body))
    expect(init.method).toBe("POST")
    expect(body.model).toBe("gpt-5.6-luna")
    expect(body.store).toBe(false)
    expect(body.reasoning).toEqual({ effort: "low" })
    expect(body.safety_identifier).toBe("hashed-user")
    expect(body.text.format.type).toBe("json_schema")
    expect(body.text.format.strict).toBe(true)
    expect(body.text.format.schema.properties.body.minLength).toBe(500)
    expect(body.text.format.schema.additionalProperties).toBe(false)
    expect(body.text.format.schema.properties.imagePlacements.items.additionalProperties).toBe(false)
    expect(body.text.format.schema.properties.imagePlacements.items.properties.afterParagraph.minimum).toBe(1)
    expect(body.instructions).toContain("사진 순서를 붙여 장면을 나열하지 마세요")
    expect(body.instructions).toContain("감정과 수련의 여운으로 바꾸어")
    expect(body.instructions).toContain("'사진', '이미지'라는 단어로 사진을 직접 지칭하지 마세요")
    expect(body.instructions).toContain("사진마다 1~2개의 핵심 시각 단서만 고르고")
    expect(String(init.body)).not.toContain("blob:")
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer test-key",
    })
  })

  it("passes a retry instruction to a new stateless request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completed(validNaver()))

    await requestOpenAIContent(
      "naver",
      request,
      { OPENAI_API_KEY: "test-key" },
      { fetcher, safetyIdentifier: "hashed-user", retryInstruction: "본문 길이를 보강해 주세요." },
    )

    const body = JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body))
    expect(body.instructions).toContain("본문 길이를 보강해 주세요.")
    expect(body).not.toHaveProperty("previous_response_id")
  })

  it("validates a Naver result", () => {
    expect(validateGeneratedContent("naver", validNaver(), request)).toEqual(validNaver())
  })

  it("validates an Instagram result with three hooks and distinct captions", () => {
    expect(validateGeneratedContent("instagram", validInstagram(), request)).toEqual(validInstagram())
  })

  it.each([
    ["unknown image", { ...validNaver(), imagePlacements: [{ imageId: "missing", afterParagraph: 1, caption: "수련 장면" }] }],
    ["duplicate image", { ...validNaver(), imagePlacements: [
      { imageId: "image-1", afterParagraph: 1, caption: "첫 장면" },
      { imageId: "image-1", afterParagraph: 2, caption: "둘째 장면" },
    ] }],
    ["paragraph zero", { ...validNaver(), imagePlacements: [{ imageId: "image-1", afterParagraph: 0, caption: "수련 장면" }] }],
    ["paragraph overflow", { ...validNaver(), imagePlacements: [{ imageId: "image-1", afterParagraph: 13, caption: "수련 장면" }] }],
  ])("rejects a Naver placement with %s semantics", async (_name, value) => {
    await expectRetryable(requestContent("naver", completed(value)).result)
  })

  it.each([
    ["unknown image", { ...validInstagram(), imageOrder: ["missing"], coverImageId: "missing" }],
    ["duplicate image", { ...validInstagram(), imageOrder: ["image-1", "image-1"] }],
    ["missing image", { ...validInstagram(), imageOrder: [] }],
    ["cover outside order", { ...validInstagram(), coverImageId: "missing" }],
  ])("rejects Instagram image order with %s semantics", async (_name, value) => {
    await expectRetryable(requestContent("instagram", completed(value)).result)
  })

  it("accepts an Instagram image-order permutation of every supplied image id", () => {
    const input = {
      ...request,
      brief: {
        ...request.brief,
        imageDescriptions: [
          { imageId: "image-1", description: "큰 창 옆 매트 위에서 두 팔을 길게 뻗은 장면" },
          { imageId: "image-2", description: "나무 바닥 위에서 블록 옆에 앉아 몸을 기울인 장면" },
        ],
      },
    }
    const instagram = { ...validInstagram(), imageOrder: ["image-2", "image-1"], coverImageId: "image-2" }

    expect(validateGeneratedContent("instagram", instagram, input)).toEqual(instagram)
  })

  it("rejects a Naver body shorter than 500 characters as retryable", async () => {
    const { result } = requestContent("naver", completed({ ...validNaver(), body: "호흡이 있는 짧은 본문" }))

    await expectRetryable(result, "네이버 본문은 500자 이상이어야 해요.")
  })

  it("rejects the wrong option count as a retryable schema violation", async () => {
    const { result } = requestContent("instagram", completed({ ...validInstagram(), hookOptions: ["호흡 하나"] }))

    await expectRetryable(result, "AI 응답 형식이 올바르지 않아요.")
  })

  it("rejects equal Instagram captions as a retryable schema violation", async () => {
    const instagram = validInstagram()
    const { result } = requestContent("instagram", completed({ ...instagram, captionShort: instagram.captionLong }))

    await expectRetryable(result, "AI 응답 형식이 올바르지 않아요.")
  })

  it("rejects unknown fields as a retryable schema violation", async () => {
    const { result } = requestContent("naver", completed({ ...validNaver(), unexpected: "field" }))

    await expectRetryable(result, "AI 응답 형식이 올바르지 않아요.")
  })

  it("rejects forbidden expressions as retryable", async () => {
    const { result } = requestContent("instagram", completed({
      ...validInstagram(),
      captionLong: "호흡을 관찰하면 몸을 치료할 수 있습니다.",
    }))

    await expectRetryable(result, "금지 표현이 콘텐츠에 포함되었어요.")
  })

  it("does not treat structural image identifiers as generated copy", () => {
    expect(() => validateGeneratedContent(
      "naver",
      validNaver(),
      { ...request, avoid: "image" },
    )).not.toThrow()
  })

  it("rejects medical claims even when they are not in the custom avoid list", async () => {
    const { result } = requestContent("naver", completed({
      ...validNaver(),
      body: `${validNaver().body} 완치`,
    }))

    await expectRetryable(result, "금지 표현이 콘텐츠에 포함되었어요.")
  })

  it.each([
    ["treatment", "호흡으로 통증을 치료해 줍니다."],
    ["complete cure", "호흡 수련으로 불편함이 완치될 수 있습니다."],
    ["healing", "호흡을 이어 가면 증상이 치유됩니다."],
    ["correction", "호흡이 척추를 교정할 수 있습니다."],
    ["recovery", "호흡을 하면 통증이 나아집니다."],
  ])("rejects a %s certainty variant without a matching custom avoid term", async (_name, claim) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completed({
      ...validNaver(),
      body: `${validNaver().body} ${claim}`,
    }))

    const result = requestOpenAIContent(
      "naver",
      { ...request, avoid: "과장" },
      { OPENAI_API_KEY: "test-key" },
      { fetcher, safetyIdentifier: "hashed-user" },
    )

    await expectRetryable(result, "금지 표현이 콘텐츠에 포함되었어요.")
  })

  it.each([
    ["treatment guarantee", "호흡 수련으로 통증을 치료해 드릴 수 있습니다."],
    ["correction guarantee", "호흡으로 척추를 교정해 드릴 수 있습니다."],
    ["cure guarantee", "이 수련은 완치를 보장합니다."],
  ])("rejects a direct %s", async (_name, claim) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completed({
      ...validNaver(),
      body: `${validNaver().body} ${claim}`,
    }))

    const result = requestOpenAIContent(
      "naver",
      { ...request, avoid: "과장" },
      { OPENAI_API_KEY: "test-key" },
      { fetcher, safetyIdentifier: "hashed-user" },
    )

    await expectRetryable(result, "금지 표현이 콘텐츠에 포함되었어요.")
  })

  it.each([
    "통증이 나아집니다.",
    "질환이 낫습니다.",
  ])("rejects medical-context recovery certainty: %s", (claim) => {
    expect(() => validateGeneratedContent(
      "naver",
      { ...validNaver(), body: `${validNaver().body} ${claim}` },
      { ...request, avoid: "과장" },
    )).toThrow("금지 표현이 콘텐츠에 포함되었어요.")
  })

  it.each([
    "무리하기보다 편안한 범위에 머무는 편이 낫습니다.",
    "동작의 연결이 나아집니다.",
  ])("allows benign comparative or movement copy: %s", (sentence) => {
    expect(() => validateGeneratedContent(
      "naver",
      { ...validNaver(), body: `${validNaver().body} ${sentence}` },
      { ...request, avoid: "과장" },
    )).not.toThrow()
  })

  it("allows benign observation copy and the class-info verification sentence", () => {
    const naver = {
      ...validNaver(),
      body: `${validNaver().body} 몸의 감각이 나아가는 방향을 살펴봅니다.`,
      classInfo: "수업 정보는 게시 전에 확인해 주세요.",
    }

    expect(() => validateGeneratedContent(
      "naver",
      naver,
      { ...request, avoid: "과장" },
    )).not.toThrow()
  })

  it("rejects content missing the required phrase as retryable", async () => {
    const withoutRequired: GenerateContentInput = { ...request, mustInclude: "반드시포함" }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completed(validInstagram()))

    const result = requestOpenAIContent(
      "instagram",
      withoutRequired,
      { OPENAI_API_KEY: "test-key" },
      { fetcher, safetyIdentifier: "hashed-user" },
    )

    await expectRetryable(result, "필수 표현이 콘텐츠에 포함되지 않았어요.")
  })

  it("classifies malformed response JSON and output JSON as retryable", async () => {
    const malformedResponse = new Response("not-json", { headers: { "Content-Type": "application/json" } })
    const malformedOutput = Response.json({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "not-json" }] }],
    })

    await expectRetryable(requestContent("naver", malformedResponse).result)
    await expectRetryable(requestContent("naver", malformedOutput).result)
  })

  it("classifies a non-object response payload as retryable", async () => {
    await expectRetryable(requestContent("naver", Response.json(null)).result)
  })

  it("classifies incomplete and refused output as retryable", async () => {
    const incomplete = Response.json({ status: "incomplete", output: [] })
    const refused = Response.json({
      status: "completed",
      output: [{ type: "message", content: [{ type: "refusal", refusal: "Cannot comply" }] }],
    })

    await expectRetryable(requestContent("naver", incomplete).result)
    await expectRetryable(requestContent("naver", refused).result)
  })

  it("classifies network errors, 429, and 5xx as retryable", async () => {
    const networkFetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network failed"))
    const networkResult = requestOpenAIContent(
      "naver",
      request,
      { OPENAI_API_KEY: "test-key" },
      { fetcher: networkFetcher, safetyIdentifier: "hashed-user" },
    )

    await expectRetryable(networkResult)
    await expectRetryable(requestContent("naver", new Response(null, { status: 429 })).result)
    await expectRetryable(requestContent("naver", new Response(null, { status: 503 })).result)
  })

  it("classifies non-429 upstream 4xx responses as non-retryable", async () => {
    const { result } = requestContent("naver", new Response("secret upstream body", { status: 401 }))
    const error = await result.catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(OpenAIContentError)
    expect(error).toMatchObject({ message: "AI 생성 요청에 실패했어요.", retryable: false })
    expect(String(error)).not.toContain("secret upstream body")
  })
})
