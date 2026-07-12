import type { ContentEnv } from "./env"
import type {
  ContentChannel,
  GenerateContentInput,
  GeneratedContent,
  GeneratedInstagram,
  GeneratedNaver,
} from "./content-types"

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
const MODEL = "gpt-5.6-luna"
const MEDICAL_CLAIM_PATTERNS = [
  /치료(?:해줍니다|해드립니다|합니다|됩니다|할수있(?:습니다|어요|다))/,
  /(?:완치|치유)(?:$|됩니다|시킵니다|될수있(?:습니다|어요|다)|할수있(?:습니다|어요|다))/,
  /교정(?:해줍니다|해드립니다|합니다|됩니다|할수있(?:습니다|어요|다))/,
  /(?:나아|낫)(?:집니다|습니다|질수있(?:습니다|어요|다)|게됩니다|게해줍니다)/,
]

interface JsonSchema {
  type: string
  [key: string]: unknown
}

export class OpenAIContentError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message)
    this.name = "OpenAIContentError"
  }
}

export async function requestOpenAIContent(
  channel: ContentChannel,
  input: GenerateContentInput,
  env: Pick<ContentEnv, "OPENAI_API_KEY">,
  options: { fetcher?: typeof fetch; safetyIdentifier: string; retryInstruction?: string },
): Promise<GeneratedContent> {
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
        instructions: promptFor(channel, options.retryInstruction),
        input: JSON.stringify(input),
        text: { format: schemaFor(channel) },
      }),
    })
  } catch {
    throw new OpenAIContentError("AI 생성 요청에 실패했어요.", true)
  }

  if (!response.ok) {
    throw new OpenAIContentError(
      "AI 생성 요청에 실패했어요.",
      response.status === 429 || response.status >= 500,
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new OpenAIContentError("AI 응답을 읽지 못했어요.", true)
  }

  if (!isRecord(payload)) throw invalidContent()
  if (payload.status !== "completed") {
    throw new OpenAIContentError("AI 생성이 완료되지 않았어요.", true)
  }

  const text = outputText(payload)
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new OpenAIContentError("AI 응답 형식이 올바르지 않아요.", true)
  }
  return validateGeneratedContent(channel, value, input)
}

export function validateGeneratedContent(
  channel: ContentChannel,
  value: unknown,
  input: GenerateContentInput,
): GeneratedContent {
  const content = channel === "naver" ? validateNaver(value) : validateInstagram(value)
  const mainText = channel === "naver"
    ? (content as GeneratedNaver).body
    : (content as GeneratedInstagram).captionLong

  const copy = generatedCopy(channel, content)
  const allText = copy.join("\n")
  if (forbiddenExpressions(input.avoid).some((expression) => allText.includes(expression))
    || copy.some(hasMedicalClaim)) {
    throw new OpenAIContentError("금지 표현이 콘텐츠에 포함되었어요.", true)
  }

  const required = input.mustInclude.trim()
  if (required && !mainText.includes(required)) {
    throw new OpenAIContentError("필수 표현이 콘텐츠에 포함되지 않았어요.", true)
  }
  return content
}

function promptFor(channel: ContentChannel, retryInstruction?: string): string {
  const common = [
    "A.P YOGA의 차분하고 과장 없는 문체로 작성하세요.",
    "입력 JSON의 메모, 필수 표현, 금지 표현, 문체와 톤을 지키세요.",
    "치료·완치·교정 보장 같은 의료적 단정을 피하세요.",
    "입력에 없는 시간, 가격, 예약 방법, 계절 정보는 게시 전에 확인할 내용으로 표시하세요.",
  ]
  const channelInstruction = channel === "naver"
    ? "네이버 본문은 수련 시작, 호흡 관찰, 신체 감각, 사진 장면, 일상 연결, 마무리를 나눈 문단으로 500자 이상 작성하고 반복으로 길이를 채우지 마세요."
    : "인스타그램은 네이버와 다른 흐름으로 작성하고 긴 캡션과 짧은 캡션의 길이와 문장을 분명히 구분하세요."
  return [...common, channelInstruction, retryInstruction?.trim()].filter(Boolean).join("\n")
}

function schemaFor(channel: ContentChannel): JsonSchema {
  const stringSchema = { type: "string", minLength: 1 }
  const stringArray = (minItems = 1, maxItems?: number) => ({
    type: "array",
    items: stringSchema,
    minItems,
    ...(maxItems === undefined ? {} : { maxItems }),
  })

  if (channel === "naver") {
    return {
      type: "json_schema",
      name: "naver_content",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["titles", "introOptions", "body", "imagePlacements", "hashtags", "classInfo"],
        properties: {
          titles: stringArray(3, 3),
          introOptions: stringArray(3, 3),
          body: { type: "string", minLength: 500 },
          imagePlacements: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["imageId", "afterParagraph", "caption"],
              properties: {
                imageId: stringSchema,
                afterParagraph: { type: "integer", minimum: 0 },
                caption: stringSchema,
              },
            },
          },
          hashtags: stringArray(),
          classInfo: stringSchema,
        },
      },
    }
  }

  return {
    type: "json_schema",
    name: "instagram_content",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["hookOptions", "captionLong", "captionShort", "hashtags", "coverImageId", "imageOrder"],
      properties: {
        hookOptions: stringArray(3, 3),
        captionLong: stringSchema,
        captionShort: stringSchema,
        hashtags: stringArray(),
        coverImageId: stringSchema,
        imageOrder: stringArray(),
      },
    },
  }
}

function outputText(payload: Record<string, unknown>): string {
  if (!Array.isArray(payload.output)) {
    throw new OpenAIContentError("AI 응답 형식이 올바르지 않아요.", true)
  }

  for (const item of payload.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue
    for (const content of item.content) {
      if (!isRecord(content)) continue
      if (content.type === "refusal") {
        throw new OpenAIContentError("AI가 콘텐츠 생성을 거절했어요.", true)
      }
      if (content.type === "output_text" && typeof content.text === "string") return content.text
    }
  }
  throw new OpenAIContentError("AI 응답에 콘텐츠가 없어요.", true)
}

function validateNaver(value: unknown): GeneratedNaver {
  const keys = ["titles", "introOptions", "body", "imagePlacements", "hashtags", "classInfo"] as const
  if (!hasExactKeys(value, keys)
    || !isStringArray(value.titles, 3)
    || !isStringArray(value.introOptions, 3)
    || typeof value.body !== "string"
    || !Array.isArray(value.imagePlacements)
    || value.imagePlacements.length === 0
    || !value.imagePlacements.every(isImagePlacement)
    || !isStringArray(value.hashtags)
    || typeof value.classInfo !== "string"
    || value.classInfo.length === 0) {
    throw invalidContent()
  }
  if (value.body.trim().length < 500) {
    throw new OpenAIContentError("네이버 본문은 500자 이상이어야 해요.", true)
  }
  return value as unknown as GeneratedNaver
}

function validateInstagram(value: unknown): GeneratedInstagram {
  const keys = ["hookOptions", "captionLong", "captionShort", "hashtags", "coverImageId", "imageOrder"] as const
  if (!hasExactKeys(value, keys)
    || !isStringArray(value.hookOptions, 3)
    || typeof value.captionLong !== "string"
    || value.captionLong.length === 0
    || typeof value.captionShort !== "string"
    || value.captionShort.length === 0
    || value.captionLong.trim() === value.captionShort.trim()
    || !isStringArray(value.hashtags)
    || typeof value.coverImageId !== "string"
    || value.coverImageId.length === 0
    || !isStringArray(value.imageOrder)) {
    throw invalidContent()
  }
  return value as unknown as GeneratedInstagram
}

function isImagePlacement(value: unknown): boolean {
  const keys = ["imageId", "afterParagraph", "caption"] as const
  return hasExactKeys(value, keys)
    && typeof value.imageId === "string"
    && value.imageId.length > 0
    && Number.isInteger(value.afterParagraph)
    && (value.afterParagraph as number) >= 0
    && typeof value.caption === "string"
    && value.caption.length > 0
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

function isStringArray(value: unknown, exactLength?: number): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && (exactLength === undefined || value.length === exactLength)
    && value.every((entry) => typeof entry === "string" && entry.length > 0)
}

function forbiddenExpressions(avoid: string): string[] {
  return avoid.split(/[,\n]/).map((value) => value.trim()).filter(Boolean)
}

function hasMedicalClaim(value: string): boolean {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\s.,!?·…'"“”‘’()[\]{}:;—–_-]+/g, "")
  return MEDICAL_CLAIM_PATTERNS.some((pattern) => pattern.test(normalized))
}

function generatedCopy(channel: ContentChannel, content: GeneratedContent): string[] {
  if (channel === "naver") {
    const naver = content as GeneratedNaver
    return [
      ...naver.titles,
      ...naver.introOptions,
      naver.body,
      ...naver.imagePlacements.map((placement) => placement.caption),
      ...naver.hashtags,
      naver.classInfo,
    ]
  }
  const instagram = content as GeneratedInstagram
  return [
    ...instagram.hookOptions,
    instagram.captionLong,
    instagram.captionShort,
    ...instagram.hashtags,
  ]
}

function invalidContent(): OpenAIContentError {
  return new OpenAIContentError("AI 응답 형식이 올바르지 않아요.", true)
}
