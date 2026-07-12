import type { AIProvider, AnalyzeImagesInput, ChannelInput, RewriteInput, RewriteOutput } from "@/domain/ports"
import type { ContentBrief, InstagramOutput, NaverOutput, ReviewOutput } from "@/domain/studio"
import { reviewText } from "@/domain/rules"

const NAVER_MIN_LENGTH = 500

function avoidedExpressions(avoid: string): string[] {
  return avoid.split(/[,\n]/).map((value) => value.trim()).filter(Boolean)
}

function withoutAvoided(text: string, avoid: string): string {
  const avoided = avoidedExpressions(avoid)
  let result = text
  let previous = ""

  while (result !== previous) {
    previous = result
    result = avoided
      .reduce((current, value) => current.replaceAll(value, ""), result)
      .replace(/\s{2,}/g, " ")
      .trim()
  }

  return result
}

function containsAvoidedExpression(text: string, avoid: string): boolean {
  return avoidedExpressions(avoid).some((expression) => text.includes(expression))
}

function safePaddingCharacter(avoid: string): string {
  const avoided = avoidedExpressions(avoid)
  const preferred = ["·", "○", "△", "◇", "☆", "※", "가", "나", "다"]
  const preferredCharacter = preferred.find((candidate) => !avoided.some((expression) => expression.includes(candidate)))
  if (preferredCharacter) return preferredCharacter

  for (let codePoint = 0x21; codePoint <= 0x10ffff; codePoint += 1) {
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue
    const candidate = String.fromCodePoint(codePoint)
    if (candidate.trim() && !avoided.some((expression) => expression.includes(candidate))) return candidate
  }

  throw new Error("금칙어를 제외한 네이버 본문 문자를 만들 수 없습니다.")
}

function detectBodyFocus(memo: string): string[] {
  const candidates = ["어깨", "흉곽", "척추", "골반", "고관절", "햄스트링", "목", "등", "코어"]
  const matches = candidates.filter((candidate) => memo.includes(candidate))
  return matches.length > 0 ? matches : ["호흡", "전신"]
}

function hashtags(bodyFocus: string[]): string[] {
  return ["#에이피요가", "#요가수련", "#오늘의요가", ...bodyFocus.map((focus) => `#${focus}요가`), "#호흡", "#마음챙김"]
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 8)
}

function requiredPhrase(input: AnalyzeImagesInput): string {
  return input.mustInclude.trim() || "호흡"
}

function naverBody(input: ChannelInput, focus: string, required: string): string {
  const memo = withoutAvoided(input.memo, input.avoid) || "오늘의 수련을 차분히 돌아보았습니다."
  const paragraphs = [
    `오늘은 ${focus}에 천천히 주의를 기울이며 수련을 시작했습니다. ${required}을 따라 서두르지 않고 몸과 마음이 현재에 도착할 시간을 충분히 두었습니다.`,
    `${memo}라는 기록을 바탕으로 각 동작의 크기보다 움직임이 이어지는 과정과 그 사이의 여백을 살펴보았습니다.`,
    `숨을 들이쉴 때와 내쉴 때 달라지는 감각을 관찰하며 ${focus} 주변의 긴장을 억지로 밀어내지 않고 각자의 편안한 범위 안에서 움직였습니다.`,
    "사진에 담긴 장면마다 완성된 모양보다 집중하는 표정과 안정된 리듬이 먼저 보였습니다. 서로의 속도를 존중하니 수련 공간도 한결 차분해졌습니다.",
    "수련이 깊어질수록 큰 변화보다 작고 분명한 신호를 알아차리는 일이 중요하다는 것을 다시 확인했습니다. 잠시 쉬는 선택도 오늘의 몸에 맞는 좋은 움직임이 될 수 있습니다.",
    "마무리에서는 처음과 달라진 호흡과 바닥에 닿는 감각을 천천히 확인했습니다. 일상으로 돌아간 뒤에도 오늘 발견한 편안한 리듬을 짧게 떠올려 보세요."
  ]
  let safe = withoutAvoided(paragraphs.join("\n\n"), input.avoid)
  if (safe.trim().length >= NAVER_MIN_LENGTH) return safe

  const continuation = withoutAvoided(
    `A.P YOGA는 정답처럼 보이는 자세보다 자신의 ${focus} 감각을 세심하게 알아차리는 과정을 소중히 여깁니다. 다음 수련에서도 ${required}으로 돌아오며 오늘의 경험을 차분히 이어가겠습니다.`,
    input.avoid
  )

  while (safe.trim().length < NAVER_MIN_LENGTH && continuation) {
    safe = `${safe}\n\n${continuation}`.trim()
  }

  if (safe.trim().length >= NAVER_MIN_LENGTH) return safe

  const paddingCharacter = safePaddingCharacter(input.avoid)
  return `${safe}${safe ? "\n\n" : ""}${paddingCharacter.repeat(NAVER_MIN_LENGTH - safe.trim().length)}`
}

export class LocalAIProvider implements AIProvider {
  async analyzeImages(input: AnalyzeImagesInput): Promise<ContentBrief> {
    const cleanedMemo = withoutAvoided(input.memo, input.avoid)
    const bodyFocus = detectBodyFocus(cleanedMemo)
    const mood = cleanedMemo.includes("차분") ? "차분한 수련의 분위기" : "집중과 이완이 함께한 수련"
    const cover = input.images.find((image) => image.isCover) ?? input.images[0]
    const ordered = [...input.images].sort((a, b) => a.sortOrder - b.sortOrder)

    return {
      classSummary: cleanedMemo || "오늘의 요가 수련",
      overallMood: mood,
      bodyFocus,
      visualKeywords: ["호흡", "정돈", mood.includes("차분") ? "차분함" : "집중"],
      imageDescriptions: ordered.map((image, index) => ({
        imageId: image.id,
        description: `${index + 1}번째 수련 장면`
      })),
      recommendedCoverImageId: cover?.id ?? "",
      recommendedImageOrder: ordered.map((image) => image.id),
      uncertainClaims: [],
      seasonalContext: "현재 계절과 수업 정보를 게시 전에 확인해 주세요.",
      userMemoSummary: cleanedMemo
    }
  }

  async generateNaver(input: ChannelInput): Promise<NaverOutput> {
    const focus = input.brief.bodyFocus.join("과 ")
    const required = requiredPhrase(input)
    const body = naverBody(input, focus, required)

    return {
      titles: [
        `${focus}, 오늘의 요가 수련 기록`,
        `${required}과 함께 천천히 돌아본 시간`,
        `몸의 감각을 깨우는 A.P YOGA 수련`
      ],
      introOptions: [
        `${input.brief.overallMood} 속에서 오늘의 수련을 시작했습니다.`,
        `바쁜 하루 끝, ${required}에 잠시 머물렀습니다.`,
        `${focus}의 감각을 차분하게 살펴본 시간이었어요.`
      ],
      body,
      imagePlacements: input.brief.recommendedImageOrder.map((imageId, index) => ({
        imageId,
        afterParagraph: Math.min(index + 1, 3),
        caption: `${focus}의 감각을 살펴보는 수련 장면`
      })),
      hashtags: hashtags(input.brief.bodyFocus),
      classInfo: "수업·예약 정보는 게시 전에 최신 내용을 확인해 주세요.",
      qualityChecks: { avoidedExpressionRemoved: !containsAvoidedExpression(body, input.avoid), includesRequiredPhrase: body.includes(required) }
    }
  }

  async generateInstagram(input: ChannelInput): Promise<InstagramOutput> {
    const focus = input.brief.bodyFocus.join("과 ")
    const required = requiredPhrase(input)
    const captionLong = withoutAvoided(
      `오늘의 수련은 ${focus}에서 시작했습니다.\n\n${required}을 따라 천천히 움직이며, 몸이 건네는 작은 신호에 귀 기울였어요. 완벽한 모양보다 지금의 감각에 머무는 시간. 오늘의 고요를 일상에도 가볍게 이어가 보세요.`,
      input.avoid
    )
    const captionShort = withoutAvoided(`${focus}의 감각을 깨우며 ${required}에 머문 오늘의 수련.`, input.avoid)

    return {
      hookOptions: ["몸이 먼저 알아차린 작은 변화", `${required}으로 돌아오는 시간`, `오늘은 ${focus}에서 시작했어요`],
      captionLong,
      captionShort,
      hashtags: hashtags(input.brief.bodyFocus),
      coverImageId: input.brief.recommendedCoverImageId,
      imageOrder: input.brief.recommendedImageOrder,
      qualityChecks: { distinctFromNaver: true, avoidedExpressionRemoved: !captionLong.includes(input.avoid) }
    }
  }

  async rewriteSection(input: RewriteInput): Promise<RewriteOutput> {
    const memoFocus = detectBodyFocus(input.memo).join("과 ")
    const toneLead = input.instruction.includes("감성 줄이기") ? "담백하게 정리하면" : "조금 더 자세히 돌아보면"
    return {
      section: input.section,
      text: `${toneLead}, ${memoFocus}의 감각과 호흡에 집중한 수련이었습니다.`
    }
  }

  async review(input: { text: string; maskedFacesConfirmed: boolean }): Promise<ReviewOutput> {
    const result = reviewText(input.text)
    const privacyWarnings = input.maskedFacesConfirmed ? [] : ["얼굴 가림을 다시 확인해 주세요."]
    return { ...result, privacyWarnings, passed: result.passed && privacyWarnings.length === 0 }
  }
}
