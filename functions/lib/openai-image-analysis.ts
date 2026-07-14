import type { ContentEnv } from "./env"
import type { AnalyzeImagesContentInput, ImageAnalysisResult } from "./content-types"
import {
  parseOpenAIResponseUsage,
  type OpenAIResponseUsage,
} from "./usage"

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
const MODEL = "gpt-5.6-luna"
const GENERIC_VISUAL_WORDS = new Set([
  "첫번째", "두번째", "세번째", "네번째", "다섯번째", "여섯번째", "일곱번째", "여덟번째", "아홉번째", "열번째",
  "번째", "사진", "이미지", "수련", "요가", "장면", "모습", "동작",
])

export interface OpenAIImageAnalysisResponse {
  data: ImageAnalysisResult
  responseUsage: OpenAIResponseUsage
}

export class OpenAIImageAnalysisError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message)
    this.name = "OpenAIImageAnalysisError"
  }
}

export async function requestOpenAIImageAnalysis(
  input: AnalyzeImagesContentInput,
  env: Pick<ContentEnv, "OPENAI_API_KEY">,
  options: { fetcher?: typeof fetch; safetyIdentifier: string; retryInstruction?: string },
): Promise<OpenAIImageAnalysisResponse> {
  const context = {
    memo: input.memo,
    mustInclude: input.mustInclude,
    avoid: input.avoid,
    writingMode: input.writingMode,
    naverTone: input.naverTone,
    instagramTone: input.instagramTone,
  }
  const content: Array<Record<string, unknown>> = [
    { type: "input_text", text: `사용자 입력과 사진 ID 목록입니다.\n${JSON.stringify(context)}` },
  ]
  for (const image of [...input.images].sort((a, b) => a.sortOrder - b.sortOrder)) {
    content.push({
      type: "input_text",
      text: JSON.stringify({ imageId: image.id, sortOrder: image.sortOrder, isCover: image.isCover }),
    })
    content.push({ type: "input_image", image_url: image.dataUrl, detail: "low" })
  }

  let response: Response
  try {
    response = await (options.fetcher ?? fetch)(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        store: false,
        reasoning: { effort: "low" },
        safety_identifier: options.safetyIdentifier,
        instructions: analysisPrompt(options.retryInstruction),
        input: [{ role: "user", content }],
        text: { format: analysisSchema() },
      }),
    })
  } catch {
    throw new OpenAIImageAnalysisError("사진 분석 요청에 실패했어요.", true)
  }

  if (!response.ok) {
    throw new OpenAIImageAnalysisError(
      "사진 분석 요청에 실패했어요.",
      response.status === 429 || response.status >= 500,
    )
  }

  const payload = await response.json().catch(() => {
    throw new OpenAIImageAnalysisError("사진 분석 응답을 읽지 못했어요.", true)
  })
  if (!isRecord(payload) || payload.status !== "completed") {
    throw new OpenAIImageAnalysisError("사진 분석이 완료되지 않았어요.", true)
  }

  let value: unknown
  try {
    value = JSON.parse(outputText(payload))
  } catch (error) {
    if (error instanceof OpenAIImageAnalysisError) throw error
    throw new OpenAIImageAnalysisError("사진 분석 응답 형식이 올바르지 않아요.", true)
  }
  const data = validateImageAnalysis(value, input)
  return { data, responseUsage: parseOpenAIResponseUsage(payload) }
}

export function validateImageAnalysis(
  value: unknown,
  input: Pick<AnalyzeImagesContentInput, "images">,
): ImageAnalysisResult {
  const keys = [
    "classSummary", "overallMood", "bodyFocus", "visualKeywords", "imageDescriptions",
    "recommendedCoverImageId", "recommendedImageOrder", "uncertainClaims", "seasonalContext", "userMemoSummary",
  ] as const
  if (!hasExactKeys(value, keys)
    || !isNonEmptyString(value.classSummary)
    || !isNonEmptyString(value.overallMood)
    || !isStringArray(value.bodyFocus, true)
    || !isStringArray(value.visualKeywords, true)
    || !Array.isArray(value.imageDescriptions)
    || !value.imageDescriptions.every(isImageDescription)
    || typeof value.recommendedCoverImageId !== "string"
    || !isStringArray(value.recommendedImageOrder, true)
    || !isStringArray(value.uncertainClaims, false)
    || typeof value.seasonalContext !== "string"
    || typeof value.userMemoSummary !== "string") {
    throw invalidAnalysis()
  }

  const suppliedIds = input.images.map((image) => image.id)
  const descriptionIds = value.imageDescriptions.map((description) => description.imageId)
  const order = value.recommendedImageOrder
  if (!sameIdSet(suppliedIds, descriptionIds)
    || !sameIdSet(suppliedIds, order)
    || !suppliedIds.includes(value.recommendedCoverImageId)) {
    throw invalidAnalysis()
  }
  if (value.imageDescriptions.some((description) => concreteVisualWords(description.description).length < 2)) {
    throw new OpenAIImageAnalysisError("구체적인 사진 설명을 만들지 못했어요.", true)
  }
  return value as ImageAnalysisResult
}

function analysisPrompt(retryInstruction?: string): string {
  return [
    "A.P YOGA 콘텐츠를 위한 사진 분석 브리프를 한국어로 작성하세요.",
    "각 사진 ID마다 실제로 보이는 공간, 빛, 소도구, 신체 배치와 동작 특징을 구체적으로 설명하세요.",
    "사진에 보이지 않는 동작 이름, 감정, 신원, 건강 상태, 수업 시간, 계절을 추측하지 마세요.",
    "확실하지 않은 내용은 uncertainClaims에 넣고 본문 사실처럼 단정하지 마세요.",
    "imageDescriptions에는 입력된 모든 사진 ID를 정확히 한 번씩 포함하세요.",
    "recommendedImageOrder에는 모든 사진 ID를 정확히 한 번씩 포함하세요.",
    retryInstruction?.trim(),
  ].filter(Boolean).join("\n")
}

function analysisSchema() {
  const string = { type: "string" }
  const nonEmptyString = { type: "string", minLength: 1 }
  const stringArray = { type: "array", items: nonEmptyString }
  return {
    type: "json_schema",
    name: "ap_yoga_image_analysis",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "classSummary", "overallMood", "bodyFocus", "visualKeywords", "imageDescriptions",
        "recommendedCoverImageId", "recommendedImageOrder", "uncertainClaims", "seasonalContext", "userMemoSummary",
      ],
      properties: {
        classSummary: nonEmptyString,
        overallMood: nonEmptyString,
        bodyFocus: stringArray,
        visualKeywords: stringArray,
        imageDescriptions: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["imageId", "description"],
            properties: { imageId: nonEmptyString, description: { type: "string", minLength: 12 } },
          },
        },
        recommendedCoverImageId: nonEmptyString,
        recommendedImageOrder: stringArray,
        uncertainClaims: { type: "array", items: nonEmptyString },
        seasonalContext: string,
        userMemoSummary: string,
      },
    },
  }
}

function concreteVisualWords(value: string): string[] {
  return (value.normalize("NFKC").match(/[가-힣A-Za-z0-9]+/g) ?? [])
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 2 && !GENERIC_VISUAL_WORDS.has(word))
}

function sameIdSet(expected: string[], actual: string[]): boolean {
  return expected.length === actual.length
    && new Set(actual).size === actual.length
    && expected.every((id) => actual.includes(id))
}

function outputText(payload: Record<string, unknown>): string {
  if (!Array.isArray(payload.output)) throw invalidAnalysis()
  for (const item of payload.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue
    for (const content of item.content) {
      if (!isRecord(content)) continue
      if (content.type === "refusal") throw new OpenAIImageAnalysisError("사진 분석이 거절됐어요.", true)
      if (content.type === "output_text" && typeof content.text === "string") return content.text
    }
  }
  throw invalidAnalysis()
}

function isImageDescription(value: unknown): value is { imageId: string; description: string } {
  return hasExactKeys(value, ["imageId", "description"])
    && isNonEmptyString(value.imageId)
    && isNonEmptyString(value.description)
}

function isStringArray(value: unknown, requireNonEmpty: boolean): value is string[] {
  return Array.isArray(value)
    && (!requireNonEmpty || value.length > 0)
    && value.every(isNonEmptyString)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim())
}

function hasExactKeys<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): value is Record<Keys[number], unknown> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function invalidAnalysis(): OpenAIImageAnalysisError {
  return new OpenAIImageAnalysisError("사진 분석 응답 형식이 올바르지 않아요.", true)
}
