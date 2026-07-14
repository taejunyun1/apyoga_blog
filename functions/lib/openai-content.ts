import type { ContentEnv } from "./env"
import type {
  ContentChannel,
  GenerateContentInput,
  GeneratedContent,
  GeneratedInstagram,
  GeneratedNaver,
  RewriteContentInput,
  RewrittenContent,
} from "./content-types"

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
const MODEL = "gpt-5.6-luna"
const DIRECT_MEDICAL_CLAIM_PATTERNS = [
  /치료(?:해(?:줍니다|드립니다|드릴수있(?:습니다|어요|다))|합니다|됩니다|할수있(?:습니다|어요|다))/,
  /(?:완치|치유)(?:$|됩니다|시킵니다|될수있(?:습니다|어요|다)|할수있(?:습니다|어요|다)|(?:를)?보장(?:합니다|드립니다|할수있(?:습니다|어요|다)))/,
  /교정(?:해(?:줍니다|드립니다|드릴수있(?:습니다|어요|다))|합니다|됩니다|할수있(?:습니다|어요|다))/,
]
const MEDICAL_RECOVERY_PATTERN = /(?:통증|질환|질병|증상|부상|상처|염증|불편감)(?:이|가|은|는|을|를)?.{0,20}(?:나아집니다|낫습니다|나아질수있(?:습니다|어요|다)|나아지게됩니다|낫게됩니다)/
const GENERIC_PHOTO_WORDS = new Set([
  "첫번째", "두번째", "세번째", "네번째", "다섯번째", "여섯번째", "일곱번째", "여덟번째", "아홉번째", "열번째",
  "번째", "사진", "이미지", "수련", "요가", "장면", "모습", "동작",
])
const PHOTO_REPORT_PATTERN = /(?:사진\s*(?:\d+|(?:첫|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*번째)|(?:\d+|첫|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*번째\s*사진)(?:에는|은|는|에서|을|를)?/u
const PHOTO_META_NARRATION_PATTERN = /(?:사진|이미지)\s*(?:속|에는|은|는|에서|에|을|를|으로는?|마다)/u

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

export async function requestOpenAIRewrite(
  input: RewriteContentInput,
  env: Pick<ContentEnv, "OPENAI_API_KEY">,
  options: { fetcher?: typeof fetch; safetyIdentifier: string; retryInstruction?: string },
): Promise<RewrittenContent> {
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
        instructions: rewritePrompt(input, options.retryInstruction),
        input: JSON.stringify(input),
        text: { format: rewriteSchema() },
      }),
    })
  } catch {
    throw new OpenAIContentError("AI 재작성 요청에 실패했어요.", true)
  }

  if (!response.ok) {
    throw new OpenAIContentError(
      "AI 재작성 요청에 실패했어요.",
      response.status === 429 || response.status >= 500,
    )
  }

  const payload = await response.json().catch(() => {
    throw new OpenAIContentError("AI 응답을 읽지 못했어요.", true)
  })
  if (!isRecord(payload) || payload.status !== "completed") {
    throw new OpenAIContentError("AI 재작성이 완료되지 않았어요.", true)
  }

  let value: unknown
  try {
    value = JSON.parse(outputText(payload))
  } catch (error) {
    if (error instanceof OpenAIContentError) throw error
    throw new OpenAIContentError("AI 응답 형식이 올바르지 않아요.", true)
  }
  return validateRewriteContent(value, input)
}

export function validateGeneratedContent(
  channel: ContentChannel,
  value: unknown,
  input: GenerateContentInput,
): GeneratedContent {
  const content = channel === "naver" ? validateNaver(value) : validateInstagram(value)
  validateImageReferences(channel, content, input)
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
  validateEmotionalPhotoCopy(channel, content)
  validatePhotoGrounding(channel, content, input)
  return content
}

export function validateRewriteContent(value: unknown, input: RewriteContentInput): RewrittenContent {
  if (!hasExactKeys(value, ["section", "text"])
    || value.section !== input.section
    || typeof value.text !== "string"
    || !value.text.trim()) {
    throw new OpenAIContentError("AI 재작성 형식이 올바르지 않아요.", true)
  }
  const text = value.text.trim()
  if (text === input.currentText.trim()) {
    throw new OpenAIContentError("이전과 다른 문구를 만들지 못했어요.", true)
  }
  if (input.channel === "naver" && input.section === "body" && text.length < 500) {
    throw new OpenAIContentError("네이버 본문은 500자 이상이어야 해요.", true)
  }
  if (input.section === "hashtags"
    && text.split(/\s+/).some((token) => !token.startsWith("#") || token.length < 2)) {
    throw new OpenAIContentError("해시태그 형식이 올바르지 않아요.", true)
  }
  if (forbiddenExpressions(input.avoid).some((expression) => text.includes(expression)) || hasMedicalClaim(text)) {
    throw new OpenAIContentError("금지 표현이 재작성 문구에 포함되었어요.", true)
  }
  return { section: input.section, text }
}

function validateImageReferences(
  channel: ContentChannel,
  content: GeneratedContent,
  input: GenerateContentInput,
): void {
  const suppliedIds = input.brief.imageDescriptions.map((image) => image.imageId)
  const supplied = new Set(suppliedIds)
  if (supplied.size !== suppliedIds.length || suppliedIds.some((id) => !id)) throw invalidContent()

  if (channel === "naver") {
    const naver = content as GeneratedNaver
    const paragraphCount = naver.body.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean).length
    const placementIds = naver.imagePlacements.map((placement) => placement.imageId)
    if (placementIds.length !== suppliedIds.length
      || new Set(placementIds).size !== placementIds.length
      || suppliedIds.some((id) => !placementIds.includes(id))
      || naver.imagePlacements.some((placement) => !supplied.has(placement.imageId)
        || placement.afterParagraph < 1
        || placement.afterParagraph > paragraphCount)) {
      throw invalidContent()
    }
    return
  }

  const instagram = content as GeneratedInstagram
  const order = instagram.imageOrder
  if (order.length !== suppliedIds.length
    || new Set(order).size !== order.length
    || order.some((id) => !supplied.has(id))
    || !order.includes(instagram.coverImageId)) {
    throw invalidContent()
  }
}

function validatePhotoGrounding(
  channel: ContentChannel,
  content: GeneratedContent,
  input: GenerateContentInput,
): void {
  const descriptions = input.brief.imageDescriptions
  const allVisualWords = [...new Set(descriptions.flatMap((description) => photoWords(description.description)))]
  if (allVisualWords.length < 2) throw photoGroundingError()

  if (channel === "naver") {
    const naver = content as GeneratedNaver
    if (wordOverlap(naver.body, allVisualWords) < 2) throw photoGroundingError()
    for (const placement of naver.imagePlacements) {
      const description = descriptions.find((item) => item.imageId === placement.imageId)
      if (!description) throw photoGroundingError()
      const expected = photoWords(description.description)
      if (wordOverlap(placement.caption, expected) < Math.min(2, expected.length)) throw photoGroundingError()
    }
    return
  }

  const instagram = content as GeneratedInstagram
  if (wordOverlap(instagram.captionLong, allVisualWords) < 2) throw photoGroundingError()
}

function validateEmotionalPhotoCopy(
  channel: ContentChannel,
  content: GeneratedContent,
): void {
  const text = channel === "naver"
    ? (content as GeneratedNaver).body
    : (content as GeneratedInstagram).captionLong
  if (PHOTO_REPORT_PATTERN.test(text) || PHOTO_META_NARRATION_PATTERN.test(text)) {
    throw new OpenAIContentError("사진 장면을 나열하지 않고 감성적인 발행 문장으로 작성해 주세요.", true)
  }
}

function photoWords(value: string): string[] {
  return [...new Set((value.normalize("NFKC").match(/[가-힣A-Za-z0-9]+/g) ?? [])
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 2 && !GENERIC_PHOTO_WORDS.has(word)))]
}

function wordOverlap(value: string, expected: string[]): number {
  const actual = new Set(photoWords(value))
  return expected.filter((word) => actual.has(word)).length
}

function photoGroundingError(): OpenAIContentError {
  return new OpenAIContentError("사진 분석 내용이 생성문에 반영되지 않았어요.", true)
}

function promptFor(channel: ContentChannel, retryInstruction?: string): string {
  const common = [
    "A.P YOGA의 차분하고 과장 없는 문체로 작성하세요.",
    "입력 JSON의 메모, 필수 표현, 금지 표현, 문체와 톤을 지키세요.",
    "imageDescriptions에서 사진마다 1~2개의 핵심 시각 단서만 고르고, 공간의 빛, 색감, 재질과 소품을 감정과 수련의 여운에 연결하세요.",
    "확인된 시각적 단서는 장면 설명으로 복사하지 말고 감정과 수련의 여운으로 바꾸어 자연스러운 서사에 녹이세요.",
    "최종 본문과 인스타그램 캡션에서는 '사진', '이미지'라는 단어로 사진을 직접 지칭하지 마세요.",
    "인물의 신체 배치나 소품 위치를 자세히 설명하거나, 사진별 요소를 빠짐없이 나열하지 마세요.",
    "사진 순서를 붙여 장면을 나열하지 마세요. '첫 번째 사진에는', '2번째 사진은', '사진 1' 같은 보고서형 표현을 사용하지 마세요.",
    "각 사진 캡션은 같은 imageId의 설명을 충실히 바꾸어 쓰고, 보이지 않는 사실을 추가하지 마세요.",
    "치료·완치·교정 보장 같은 의료적 단정을 피하세요.",
    "입력에 없는 시간, 가격, 예약 방법, 계절 정보는 게시 전에 확인할 내용으로 표시하세요.",
  ]
  const channelInstruction = channel === "naver"
    ? "네이버 본문은 수련 시작, 호흡 관찰, 신체 감각, 공간에서 느낀 여운, 일상 연결, 마무리를 나눈 문단으로 500자 이상 작성하고 반복으로 길이를 채우지 마세요."
    : "인스타그램은 네이버와 다른 흐름으로 작성하고 긴 캡션과 짧은 캡션의 길이와 문장을 분명히 구분하세요."
  return [...common, channelInstruction, retryInstruction?.trim()].filter(Boolean).join("\n")
}

function rewritePrompt(input: RewriteContentInput, retryInstruction?: string): string {
  return [
    "A.P YOGA 콘텐츠에서 지정된 현재 영역만 재작성하세요.",
    "다른 영역을 바꾸거나 입력에 없는 사실을 발명하지 마세요.",
    `재작성 요청: ${input.instruction}`,
    `수련 메모: ${input.memo}`,
    `문체 톤: ${input.tone}`,
    `금지 표현: ${input.avoid}`,
    "치료·완치·교정 보장 같은 의료적 단정을 피하세요.",
    "네이버 본문을 재작성할 때는 500자 이상을 유지하세요.",
    "철학 줄이기 요청은 추상적인 단어를 구체적인 호흡과 신체 감각으로 바꾸세요.",
    "사진 분위기 더하기 요청은 입력에 없는 인물, 동작, 장소를 단정하지 말고 확인된 빛, 색감, 공간과 소품을 감정과 수련의 여운으로 연결하세요.",
    "사진 분위기 더하기 요청에서도 사진 번호나 순서를 붙이지 말고, '사진'이나 '이미지'를 직접 지칭하거나 장면 요소를 나열하지 마세요.",
    retryInstruction?.trim(),
  ].filter(Boolean).join("\n")
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
                afterParagraph: { type: "integer", minimum: 1 },
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

function rewriteSchema(): JsonSchema {
  return {
    type: "json_schema",
    name: "rewrite_content",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["section", "text"],
      properties: {
        section: {
          type: "string",
          enum: ["title", "intro", "body", "hook", "caption", "short", "hashtags"],
        },
        text: { type: "string", minLength: 1 },
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
    && (value.afterParagraph as number) >= 1
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
  return DIRECT_MEDICAL_CLAIM_PATTERNS.some((pattern) => pattern.test(normalized))
    || MEDICAL_RECOVERY_PATTERN.test(normalized)
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
