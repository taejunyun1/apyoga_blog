import type {
  ContentChannel,
  RewriteContentInput,
  RewriteNaverTitleAndBodyContentInput,
  RewriteSection,
} from "../../lib/content-types"
import type { ContentEnv, PagesHandler } from "../../lib/env"
import { isSameOriginJson, json } from "../../lib/http"
import {
  OpenAIContentError,
  requestOpenAINaverTitleAndBodyRewrite,
  requestOpenAIRewrite,
} from "../../lib/openai-content"
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
import { hashedSafetyIdentifier } from "./generate"

const SECTIONS: Record<ContentChannel, ReadonlySet<RewriteSection>> = {
  naver: new Set(["title", "intro", "body"]),
  instagram: new Set(["hook", "caption", "short", "hashtags"]),
}
const TONES = new Set<RewriteContentInput["tone"]>(["plain", "emotional", "deep"])

interface RewriteDependencies {
  rewrite: typeof requestOpenAIRewrite
  rewriteTitleAndBody: typeof requestOpenAINaverTitleAndBodyRewrite
  safetyIdentifier(): string | Promise<string>
}

interface RewriteRequest {
  draftId: string
  input: RewriteContentInput | RewriteNaverTitleAndBodyContentInput
}

export async function handleContentRewrite(
  request: Request,
  env: ContentEnv,
  dependencies: RewriteDependencies = {
    rewrite: requestOpenAIRewrite,
    rewriteTitleAndBody: requestOpenAINaverTitleAndBodyRewrite,
    safetyIdentifier: () => hashedSafetyIdentifier(env.AUTH_USERNAME),
  },
): Promise<Response> {
  if (!isSameOriginJson(request)) {
    return json({ message: "요청을 확인해 주세요." }, 403)
  }

  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY_BYTES) {
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

  let parsed: RewriteRequest
  try {
    parsed = validateRewriteRequest(await readJsonBody(request))
  } catch (error) {
    return json(
      { message: error instanceof RequestBodyTooLargeError ? "입력 내용이 너무 길어요." : "요청을 확인해 주세요." },
      error instanceof RequestBodyTooLargeError ? 413 : 400,
    )
  }

  if ("kind" in parsed.input && parsed.input.kind === "naver-title-body") {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await dependencies.rewriteTitleAndBody(parsed.input, env, {
          safetyIdentifier: await dependencies.safetyIdentifier(),
          retryInstruction: attempt === 1
            ? "이전 결과의 오류를 수정하고 모든 재작성 제약을 충족하세요."
            : undefined,
        })
        const usage = await recordCompletedOpenAIUsage(
          env,
          parsed.draftId,
          "naver-title-body",
          result.responseUsage,
          usageRates,
        )
        return json({ source: "openai", data: { title: result.data.title, body: result.data.body }, usage })
      } catch (error) {
        if (!(error instanceof OpenAIContentError) || !error.retryable) break
      }
    }
    return json({ message: "AI 재작성이 지연되어 로컬 재작성으로 전환합니다." }, 502)
  }

  const sectionInput = parsed.input as RewriteContentInput
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await dependencies.rewrite(sectionInput, env, {
        safetyIdentifier: await dependencies.safetyIdentifier(),
        retryInstruction: attempt === 1
          ? "이전 결과의 오류를 수정하고 모든 재작성 제약을 충족하세요."
          : undefined,
      })
      const usage = await recordCompletedOpenAIUsage(
        env,
        parsed.draftId,
        "rewrite",
        result.responseUsage,
        usageRates,
      )
      return json({
        source: "openai",
        data: { section: result.data.section, text: result.data.text },
        usage,
      })
    } catch (error) {
      if (!(error instanceof OpenAIContentError) || !error.retryable) break
    }
  }

  return json({ message: "AI 재작성이 지연되어 로컬 재작성으로 전환합니다." }, 502)
}

function validateRewriteRequest(value: unknown): RewriteRequest {
  if (!isRecord(value) || !isOpaqueDraftId(value.draftId)) {
    throw new Error("invalid rewrite request")
  }
  const { draftId, ...input } = value
  return { draftId, input: validateRewriteInput(input) }
}

function validateRewriteInput(value: unknown): RewriteContentInput | RewriteNaverTitleAndBodyContentInput {
  if (hasExactKeys(value, [
    "kind",
    "instruction",
    "currentTitle",
    "currentBody",
    "memo",
    "photoContext",
    "avoid",
    "tone",
  ])) {
    if (value.kind !== "naver-title-body"
      || !isBoundedString(value.instruction, 100)
      || !value.instruction.trim()
      || !isBoundedString(value.currentTitle, 500)
      || !value.currentTitle.trim()
      || !isBoundedString(value.currentBody, 12_000)
      || !value.currentBody.trim()
      || !isBoundedString(value.memo, 4_000)
      || !value.memo.trim()
      || !isBoundedString(value.photoContext, 8_000)
      || !value.photoContext.trim()
      || !isBoundedString(value.avoid, 500)
      || typeof value.tone !== "string"
      || !TONES.has(value.tone as RewriteContentInput["tone"])) {
      throw new Error("invalid title body rewrite request")
    }
    return value as unknown as RewriteNaverTitleAndBodyContentInput
  }

  if (!hasExactKeys(value, [
    "channel",
    "section",
    "instruction",
    "currentText",
    "memo",
    "avoid",
    "tone",
  ])
    || (value.channel !== "naver" && value.channel !== "instagram")
    || typeof value.section !== "string"
    || !SECTIONS[value.channel].has(value.section as RewriteSection)
    || !isBoundedString(value.instruction, 100)
    || !isBoundedString(value.currentText, 12_000)
    || !value.currentText.trim()
    || !isBoundedString(value.memo, 4_000)
    || !isBoundedString(value.avoid, 500)
    || typeof value.tone !== "string"
    || !TONES.has(value.tone as RewriteContentInput["tone"])) {
    throw new Error("invalid rewrite request")
  }
  return value as unknown as RewriteContentInput
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isOpaqueDraftId(value: unknown): value is string {
  return isBoundedString(value, 256) && Boolean(value.trim())
}

export const onRequestPost: PagesHandler<ContentEnv> = ({ request, env }) => (
  handleContentRewrite(request, env)
)
