import type { ContentEnv, PagesHandler } from "../lib/env"
import { isSameOriginRequest, json } from "../lib/http"
import { projectUsageSummary, type UsageSummary } from "../lib/usage"

export const onRequestGet: PagesHandler<ContentEnv> = async ({ request, env }) => {
  if (!isSameOriginRequest(request)) return json({ message: "요청을 확인해 주세요." }, 403)
  try {
    const summary = await projectUsageSummary(env)
    if (!isUsageSummary(summary)) throw new Error("invalid usage summary")
    return json(summary)
  } catch {
    return json({ message: "AI 사용량을 불러오지 못했어요." }, 500)
  }
}

export const onRequest: PagesHandler<ContentEnv> = (context) => {
  if (context.request.method !== "GET") return json({ message: "허용되지 않은 요청이에요." }, 405, { Allow: "GET" })
  return onRequestGet(context)
}

function isUsageSummary(value: UsageSummary): boolean {
  return isNonNegativeSafeInteger(value.inputTokens)
    && isNonNegativeSafeInteger(value.cachedInputTokens)
    && value.cachedInputTokens <= value.inputTokens
    && isNonNegativeSafeInteger(value.outputTokens)
    && isNonNegativeSafeInteger(value.totalTokens)
    && value.totalTokens === value.inputTokens + value.outputTokens
    && isNonNegativeSafeInteger(value.estimatedKrw)
    && isNonNegativeSafeInteger(value.requestCount)
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}
