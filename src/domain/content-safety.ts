const DIRECT_MEDICAL_CLAIM_PATTERNS = [
  /치료(?:해(?:줍니다|드립니다|드릴수있(?:습니다|어요|다))|합니다|됩니다|할수있(?:습니다|어요|다))/,
  /(?:완치|치유)(?:$|됩니다|시킵니다|될수있(?:습니다|어요|다)|할수있(?:습니다|어요|다)|(?:를)?보장(?:합니다|드립니다|할수있(?:습니다|어요|다)))/,
  /교정(?:해(?:줍니다|드립니다|드릴수있(?:습니다|어요|다))|합니다|됩니다|할수있(?:습니다|어요|다))/,
]

const MEDICAL_RECOVERY_PATTERN = /(?:통증|질환|질병|증상|부상|상처|염증|불편감)(?:이|가|은|는|을|를)?.{0,20}?(?:나아집니다|낫습니다|나아질수있(?:습니다|어요|다)|나아지게됩니다|낫게됩니다)/
const MEDICAL_CLAIM_PATTERNS = [...DIRECT_MEDICAL_CLAIM_PATTERNS, MEDICAL_RECOVERY_PATTERN]

export function forbiddenExpressions(avoid: string): string[] {
  return avoid.split(/[,\n]/).map((value) => value.trim()).filter(Boolean)
}

export function countMedicalClaimOccurrences(value: string): number {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\s.,!?·…'"“”‘’()[\]{}:;—–_-]+/g, "")
  return MEDICAL_CLAIM_PATTERNS.reduce((count, pattern) => (
    count + (normalized.match(new RegExp(pattern.source, "g"))?.length ?? 0)
  ), 0)
}

export function hasMedicalClaim(value: string): boolean {
  return countMedicalClaimOccurrences(value) > 0
}

export function sanitizeLocalFragment(value: string, avoid: string): string {
  if (hasMedicalClaim(value)) return ""
  const expressions = forbiddenExpressions(avoid)
  let result = value
  let previous = ""

  while (result !== previous) {
    previous = result
    result = expressions.reduce((copy, expression) => copy.replaceAll(expression, ""), result)
  }

  result = result.replace(/[ \t]{2,}/g, " ").trim()
  return hasMedicalClaim(result) ? "" : result
}

export function assertSafeRequiredPhrase(required: string, avoid: string): string {
  const phrase = required.trim()
  if (!phrase) return ""
  if (hasMedicalClaim(phrase) || sanitizeLocalFragment(phrase, avoid) !== phrase) {
    throw new Error("필수 표현이 금지 표현 또는 의료적 단정과 충돌해요. 입력을 수정해 주세요.")
  }
  return phrase
}

export function isSafePublishableCopy(values: string[], avoid: string): boolean {
  const forbidden = forbiddenExpressions(avoid)
  return values.every((value) => !hasMedicalClaim(value)
    && !forbidden.some((expression) => value.includes(expression)))
}
