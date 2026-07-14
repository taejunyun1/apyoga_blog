import type { AnalyzeImagesContentInput } from "../../lib/content-types"
import type { ContentEnv, PagesHandler } from "../../lib/env"
import { isSameOriginJson, json } from "../../lib/http"
import {
  OpenAIImageAnalysisError,
  requestOpenAIImageAnalysis,
} from "../../lib/openai-image-analysis"
import {
  recordCompletedOpenAIUsage,
  usageRatesFromEnv,
} from "../../lib/usage-accounting"
import {
  hasExactKeys,
  isBoundedString,
  readJsonBody,
  RequestBodyTooLargeError,
} from "../../lib/request-body"
import { hashedSafetyIdentifier } from "./generate"

export const MAX_IMAGE_ANALYSIS_BODY_BYTES = 6 * 1024 * 1024
const MAX_IMAGE_DATA_URL_LENGTH = 600_000
const WRITING_MODES = new Set(["auto", "record", "essay", "philosophy", "body-sense", "space", "daily"])
const TONES = new Set(["plain", "emotional", "deep"])

interface ImageAnalysisDependencies {
  analyze: typeof requestOpenAIImageAnalysis
  safetyIdentifier(): string | Promise<string>
}

interface ImageAnalysisRequest {
  draftId: string
  input: AnalyzeImagesContentInput
}

export async function handleImageAnalysis(
  request: Request,
  env: ContentEnv,
  dependencies: ImageAnalysisDependencies = {
    analyze: requestOpenAIImageAnalysis,
    safetyIdentifier: () => hashedSafetyIdentifier(env.AUTH_USERNAME),
  },
): Promise<Response> {
  if (!isSameOriginJson(request)) return json({ message: "요청을 확인해 주세요." }, 403)
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_IMAGE_ANALYSIS_BODY_BYTES) {
    return json({ message: "사진 분석 요청이 너무 커요." }, 413)
  }
  if (!env.OPENAI_API_KEY) return json({ message: "AI 설정을 확인해 주세요." }, 500)

  let usageRates
  try {
    usageRates = usageRatesFromEnv(env)
  } catch {
    return json({ message: "AI 설정을 확인해 주세요." }, 500)
  }

  let parsed: ImageAnalysisRequest
  try {
    parsed = validateImageAnalysisRequest(await readJsonBody(request, MAX_IMAGE_ANALYSIS_BODY_BYTES))
  } catch (error) {
    const tooLarge = error instanceof RequestBodyTooLargeError
    return json({ message: tooLarge ? "사진 분석 요청이 너무 커요." : "요청을 확인해 주세요." }, tooLarge ? 413 : 400)
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await dependencies.analyze(parsed.input, env, {
        safetyIdentifier: await dependencies.safetyIdentifier(),
        retryInstruction: attempt === 1 ? "모든 사진을 다시 확인하고 구체적인 시각 설명을 작성하세요." : undefined,
      })
      const usage = await recordCompletedOpenAIUsage(
        env,
        parsed.draftId,
        "image-analysis",
        result.responseUsage,
        usageRates,
      )
      return json({ source: "openai", data: result.data, usage })
    } catch (error) {
      if (!(error instanceof OpenAIImageAnalysisError) || !error.retryable) break
    }
  }
  return json({ message: "사진을 구체적으로 분석하지 못했어요. 잠시 후 다시 시도해 주세요." }, 502)
}

function validateImageAnalysisRequest(value: unknown): ImageAnalysisRequest {
  if (!hasExactKeys(value, [
    "draftId",
    "memo", "mustInclude", "avoid", "writingMode", "naverTone", "instagramTone", "images",
  ])
    || !isOpaqueDraftId(value.draftId)
    || !isBoundedString(value.memo, 4_000)
    || !value.memo.trim()
    || !isBoundedString(value.mustInclude, 500)
    || !isBoundedString(value.avoid, 500)
    || typeof value.writingMode !== "string"
    || !WRITING_MODES.has(value.writingMode)
    || typeof value.naverTone !== "string"
    || !TONES.has(value.naverTone)
    || typeof value.instagramTone !== "string"
    || !TONES.has(value.instagramTone)
    || !Array.isArray(value.images)
    || value.images.length < 1
    || value.images.length > 10
    || !value.images.every(isAnalysisImage)) {
    throw new Error("invalid image analysis request")
  }
  const { draftId, ...inputValue } = value
  const input = inputValue as unknown as AnalyzeImagesContentInput
  const ids = input.images.map((image) => image.id)
  const sortOrders = input.images.map((image) => image.sortOrder)
  if (new Set(ids).size !== ids.length || new Set(sortOrders).size !== sortOrders.length) {
    throw new Error("duplicate image reference")
  }
  return { draftId, input }
}

function isOpaqueDraftId(value: unknown): value is string {
  return isBoundedString(value, 256) && Boolean(value.trim())
}

function isAnalysisImage(value: unknown): value is AnalyzeImagesContentInput["images"][number] {
  return hasExactKeys(value, ["id", "isCover", "sortOrder", "dataUrl"])
    && isBoundedString(value.id, 100)
    && Boolean(value.id.trim())
    && typeof value.isCover === "boolean"
    && Number.isInteger(value.sortOrder)
    && (value.sortOrder as number) >= 0
    && (value.sortOrder as number) < 10
    && typeof value.dataUrl === "string"
    && value.dataUrl.length <= MAX_IMAGE_DATA_URL_LENGTH
    && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.dataUrl)
}

export const onRequestPost: PagesHandler<ContentEnv> = ({ request, env }) => handleImageAnalysis(request, env)
