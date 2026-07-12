import type { ContentChannel, GenerateContentInput } from "../../lib/content-types"
import type { ContentEnv, PagesHandler } from "../../lib/env"
import { isSameOriginJson, json } from "../../lib/http"
import { OpenAIContentError, requestOpenAIContent } from "../../lib/openai-content"

const MAX_BODY_BYTES = 32_768
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

class RequestBodyTooLargeError extends Error {}

interface ContentRequest {
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
      const data = await dependencies.generate(parsed.channel, parsed.input, env, {
        safetyIdentifier: await dependencies.safetyIdentifier(),
        retryInstruction: attempt === 1
          ? "이전 결과의 오류를 수정하고 모든 제약을 충족하세요."
          : undefined,
      })
      return json({ channel: parsed.channel, source: "openai", data })
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

async function readJsonBody(request: Request): Promise<unknown> {
  const bytes = await readBoundedBody(request.body)
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  return JSON.parse(raw)
}

async function readBoundedBody(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  if (!body) throw new Error("missing request body")

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      totalBytes += value.byteLength
      if (totalBytes > MAX_BODY_BYTES) {
        try {
          await reader.cancel()
        } catch {
          // The body is already rejected; cancellation failure must not change the response.
        }
        throw new RequestBodyTooLargeError()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function validateContentRequest(value: unknown): ContentRequest {
  if (!hasExactKeys(value, ["channel", "input"])
    || (value.channel !== "naver" && value.channel !== "instagram")
    || !isGenerateContentInput(value.input)) {
    throw new Error("invalid content request")
  }
  return value as unknown as ContentRequest
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

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength
}

function isBoundedStringArray(value: unknown, maxLength: number): value is string[] {
  return Array.isArray(value)
    && value.length <= maxLength
    && value.every((entry) => typeof entry === "string")
}

function hasExactKeys<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): value is Record<Keys[number], unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

export const onRequestPost: PagesHandler<ContentEnv> = ({ request, env }) => (
  handleContentGeneration(request, env)
)
