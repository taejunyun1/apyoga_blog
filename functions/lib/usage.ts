import type { ContentEnv } from "./env"

export interface OpenAIResponseUsage {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
}

export interface UsageRates {
  inputKrwPerMillion: number
  cachedInputKrwPerMillion: number
  outputKrwPerMillion: number
}

export interface UsageRecord extends OpenAIResponseUsage {
  draftId: string
  requestKind: string
  model: string
  estimatedKrw: number
  createdAt: string
}

export interface UsageSummary extends OpenAIResponseUsage {
  totalTokens: number
  estimatedKrw: number
  requestCount: number
}

interface UsageSummaryRow {
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  estimated_krw: number
  request_count: number
}

const MAX_LEDGER_IDENTIFIER_LENGTH = 256
const MAX_LEDGER_TIMESTAMP_LENGTH = 64

export function parseOpenAIResponseUsage(payload: unknown): OpenAIResponseUsage {
  if (!isRecord(payload) || !isRecord(payload.usage)) throw invalidUsage()

  const inputTokens = payload.usage.input_tokens
  const outputTokens = payload.usage.output_tokens
  const details = payload.usage.input_tokens_details
  const cachedInputTokens = details === undefined
    ? 0
    : isRecord(details)
      ? details.cached_tokens
      : undefined

  if (!isTokenCount(inputTokens) || !isTokenCount(cachedInputTokens) || !isTokenCount(outputTokens)) {
    throw invalidUsage()
  }
  if (cachedInputTokens > inputTokens) throw invalidUsage()

  return { inputTokens, cachedInputTokens, outputTokens }
}

export function estimateUsageKrw(usage: OpenAIResponseUsage, rates: UsageRates): number {
  if (!isValidUsage(usage)) throw invalidUsage()
  if (!isValidRates(rates)) throw new Error("AI 사용량 가격 형식이 올바르지 않아요.")

  const uncachedInput = usage.inputTokens - usage.cachedInputTokens
  const estimate = Math.round((uncachedInput * rates.inputKrwPerMillion
    + usage.cachedInputTokens * rates.cachedInputKrwPerMillion
    + usage.outputTokens * rates.outputKrwPerMillion) / 1_000_000)
  if (!Number.isSafeInteger(estimate) || estimate < 0) {
    throw new Error("AI 사용량 비용 형식이 올바르지 않아요.")
  }
  return estimate
}

export async function recordUsage(env: Pick<ContentEnv, "AUTH_DB">, record: UsageRecord): Promise<void> {
  if (!isValidUsageRecord(record)) throw new Error("AI 사용량 기록 형식이 올바르지 않아요.")

  const result = await usageSession(env)
    .prepare(`INSERT INTO api_usage (
      draft_id, request_kind, model, input_tokens, cached_input_tokens, output_tokens, estimated_krw, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
    .bind(
      record.draftId,
      record.requestKind,
      record.model,
      record.inputTokens,
      record.cachedInputTokens,
      record.outputTokens,
      record.estimatedKrw,
      record.createdAt,
    )
    .run()

  if (!result.success || result.meta.changes !== 1) {
    throw new Error("AI 사용량 저장에 실패했어요.")
  }
}

export async function projectUsageSummary(env: Pick<ContentEnv, "AUTH_DB">): Promise<UsageSummary> {
  const row = await usageSession(env)
    .prepare(`SELECT
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(estimated_krw), 0) AS estimated_krw,
      COUNT(*) AS request_count
    FROM api_usage`)
    .first<UsageSummaryRow>()

  const inputTokens = row?.input_tokens ?? 0
  const cachedInputTokens = row?.cached_input_tokens ?? 0
  const outputTokens = row?.output_tokens ?? 0

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedKrw: row?.estimated_krw ?? 0,
    requestCount: row?.request_count ?? 0,
  }
}

function usageSession(env: Pick<ContentEnv, "AUTH_DB">) {
  if (!env.AUTH_DB) throw new Error("AI 사용량 저장소를 사용할 수 없어요.")
  return env.AUTH_DB.withSession("first-primary")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0
}

function isValidUsage(usage: OpenAIResponseUsage): boolean {
  return isTokenCount(usage.inputTokens)
    && isTokenCount(usage.cachedInputTokens)
    && isTokenCount(usage.outputTokens)
    && usage.cachedInputTokens <= usage.inputTokens
}

function isValidUsageRecord(record: unknown): record is UsageRecord {
  return isRecord(record)
    && isPersistableCount(record.inputTokens)
    && isPersistableCount(record.cachedInputTokens)
    && isPersistableCount(record.outputTokens)
    && record.cachedInputTokens <= record.inputTokens
    && isPersistableCount(record.estimatedKrw)
    && isBoundedText(record.draftId, MAX_LEDGER_IDENTIFIER_LENGTH)
    && isBoundedText(record.requestKind, MAX_LEDGER_IDENTIFIER_LENGTH)
    && isBoundedText(record.model, MAX_LEDGER_IDENTIFIER_LENGTH)
    && isValidTimestamp(record.createdAt)
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength && Boolean(value.trim())
}

function isPersistableCount(value: unknown): value is number {
  return isTokenCount(value) && Number.isSafeInteger(value)
}

function isValidTimestamp(value: unknown): value is string {
  if (!isBoundedText(value, MAX_LEDGER_TIMESTAMP_LENGTH)) return false
  const timestamp = new Date(value)
  return Number.isFinite(timestamp.valueOf()) && timestamp.toISOString() === value
}

function isValidRates(rates: UsageRates): boolean {
  return Number.isFinite(rates.inputKrwPerMillion)
    && rates.inputKrwPerMillion >= 0
    && Number.isFinite(rates.cachedInputKrwPerMillion)
    && rates.cachedInputKrwPerMillion >= 0
    && Number.isFinite(rates.outputKrwPerMillion)
    && rates.outputKrwPerMillion >= 0
}

function invalidUsage(): Error {
  return new Error("AI 사용량 형식이 올바르지 않아요.")
}
