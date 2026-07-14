import type { ContentChannel, GenerateContentInput } from "../../lib/content-types"
import type { ContentEnv, PagesHandler } from "../../lib/env"
import { isSameOriginJson, json } from "../../lib/http"
import { OpenAIContentError, requestOpenAIContent } from "../../lib/openai-content"
import {
  recordCompletedOpenAIUsage,
  usageRatesFromEnv,
} from "../../lib/usage-accounting"
import {
  hasExactKeys,
  isBoundedString,
  MAX_BODY_BYTES,
  readJsonBody,
  RequestBodyTooLargeError,
} from "../../lib/request-body"

const WRITING_MODES = new Set<GenerateContentInput["writingMode"]>([
  "auto",
  "record",
  "essay",
  "philosophy",
  "body-sense",
  "space",
  "daily",
])
const TONES = new Set<GenerateContentInput["tone"]>(["plain", "emotional", "deep"])

interface ContentRequest {
  draftId: string
  channel: ContentChannel
  input: GenerateContentInput
}

interface ContentDependencies {
  generate: typeof requestOpenAIContent
  safetyIdentifier(): string | Promise<string>
}

export async function handleContentGeneration(
  request: Request,
  env: ContentEnv,
  dependencies: ContentDependencies = {
    generate: requestOpenAIContent,
    safetyIdentifier: () => hashedSafetyIdentifier(env.AUTH_USERNAME),
  },
): Promise<Response> {
  if (!isSameOriginJson(request)) {
    return json({ message: "요청을 확인해 주세요." }, 403)
  }

  const declaredLength = Number(request.headers.get("Content-Length") ?? 0)
  if (declaredLength > MAX_BODY_BYTES) {
    return json({ message: "입력 내용이 너무 길어요." }, 413)
  }
  if (!env.OPENAI_API_KEY) {
    return json({ message: "AI 설정을 확인해 주세요." }, 500)
  }

  let usageRates
  try {
    usageRates = usageRatesFromEnv(env)
  } catch {
    return json({ message: "AI 설정을 확인해 주세요." }, 500)
  }

  let parsed: ContentRequest
  try {
    parsed = validateContentRequest(await readJsonBody(request))
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ message: "입력 내용이 너무 길어요." }, 413)
    }
    return json({ message: "요청을 확인해 주세요." }, 400)
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await dependencies.generate(parsed.channel, parsed.input, env, {
        safetyIdentifier: await dependencies.safetyIdentifier(),
        retryInstruction: attempt === 1
          ? "이전 결과의 오류를 수정하고 모든 제약을 충족하세요."
          : undefined,
      })
      const usage = await recordCompletedOpenAIUsage(
        env,
        parsed.draftId,
        parsed.channel,
        result.responseUsage,
        usageRates,
      )
      return json({ channel: parsed.channel, source: "openai", data: result.data, usage })
    } catch (error) {
      if (!(error instanceof OpenAIContentError) || !error.retryable) break
    }
  }

  return json({ message: "AI 생성이 지연되어 로컬 초안으로 전환합니다." }, 502)
}

export async function hashedSafetyIdentifier(account: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(account))
  return Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function validateContentRequest(value: unknown): ContentRequest {
  if (!hasExactKeys(value, ["draftId", "channel", "input"])
    || !isOpaqueDraftId(value.draftId)
    || (value.channel !== "naver" && value.channel !== "instagram")
    || !isGenerateContentInput(value.input)) {
    throw new Error("invalid content request")
  }
  return value as unknown as ContentRequest
}

function isOpaqueDraftId(value: unknown): value is string {
  return isBoundedString(value, 256) && Boolean(value.trim())
}

function isGenerateContentInput(value: unknown): value is GenerateContentInput {
  if (!hasExactKeys(value, ["memo", "mustInclude", "avoid", "writingMode", "tone", "brief"])
    || !isBoundedString(value.memo, 4_000)
    || !isBoundedString(value.mustInclude, 500)
    || !isBoundedString(value.avoid, 500)
    || typeof value.writingMode !== "string"
    || !WRITING_MODES.has(value.writingMode as GenerateContentInput["writingMode"])
    || typeof value.tone !== "string"
    || !TONES.has(value.tone as GenerateContentInput["tone"])) {
    return false
  }

  const brief = value.brief
  return hasExactKeys(brief, [
    "classSummary",
    "overallMood",
    "bodyFocus",
    "imageDescriptions",
    "recommendedCoverImageId",
    "recommendedImageOrder",
  ])
    && typeof brief.classSummary === "string"
    && typeof brief.overallMood === "string"
    && isBoundedStringArray(brief.bodyFocus, 10)
    && Array.isArray(brief.imageDescriptions)
    && brief.imageDescriptions.length <= 10
    && brief.imageDescriptions.every(isImageDescription)
    && typeof brief.recommendedCoverImageId === "string"
    && isBoundedStringArray(brief.recommendedImageOrder, 10)
}

function isImageDescription(value: unknown): boolean {
  return hasExactKeys(value, ["imageId", "description"])
    && typeof value.imageId === "string"
    && typeof value.description === "string"
}

function isBoundedStringArray(value: unknown, maxLength: number): value is string[] {
  return Array.isArray(value)
    && value.length <= maxLength
    && value.every((entry) => typeof entry === "string")
}

export const onRequestPost: PagesHandler<ContentEnv> = ({ request, env }) => (
  handleContentGeneration(request, env)
)
