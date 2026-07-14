import type { ContentEnv } from "./env"
import {
  estimateUsageKrw,
  recordUsage,
  type OpenAIResponseUsage,
  type UsageRates,
  type UsageSummary,
} from "./usage"

export const OPENAI_USAGE_MODEL = "gpt-5.6-luna"

export function usageRatesFromEnv(env: Pick<ContentEnv,
  "OPENAI_INPUT_KRW_PER_MILLION"
  | "OPENAI_CACHED_INPUT_KRW_PER_MILLION"
  | "OPENAI_OUTPUT_KRW_PER_MILLION"
>): UsageRates {
  return {
    inputKrwPerMillion: configuredRate(env.OPENAI_INPUT_KRW_PER_MILLION),
    cachedInputKrwPerMillion: configuredRate(env.OPENAI_CACHED_INPUT_KRW_PER_MILLION),
    outputKrwPerMillion: configuredRate(env.OPENAI_OUTPUT_KRW_PER_MILLION),
  }
}

export async function recordCompletedOpenAIUsage(
  env: Pick<ContentEnv, "AUTH_DB">,
  draftId: string,
  requestKind: string,
  responseUsage: OpenAIResponseUsage,
  rates: UsageRates,
): Promise<UsageSummary> {
  const estimatedKrw = estimateUsageKrw(responseUsage, rates)
  await recordUsage(env, {
    draftId,
    requestKind,
    model: OPENAI_USAGE_MODEL,
    ...responseUsage,
    estimatedKrw,
    createdAt: new Date().toISOString(),
  })
  return {
    ...responseUsage,
    totalTokens: responseUsage.inputTokens + responseUsage.outputTokens,
    estimatedKrw,
    requestCount: 1,
  }
}

function configuredRate(value: string | undefined): number {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("AI 사용량 가격 설정이 필요해요.")
  }
  const rate = Number(value)
  if (!Number.isFinite(rate) || rate < 0) {
    throw new Error("AI 사용량 가격 설정이 올바르지 않아요.")
  }
  return rate
}
