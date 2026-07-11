import type { AIProvider, AnalyzeImagesInput, ChannelInput, RewriteInput, RewriteOutput } from "@/domain/ports"
import type { ContentBrief, InstagramOutput, NaverOutput, ReviewOutput } from "@/domain/studio"
import { reviewText } from "@/domain/rules"

function withoutAvoided(text: string, avoid: string): string {
  const avoided = avoid.split(/[,\n]/).map((value) => value.trim()).filter(Boolean)
  return avoided.reduce((result, value) => result.replaceAll(value, ""), text).replace(/\s{2,}/g, " ").trim()
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
    const memo = withoutAvoided(input.memo, input.avoid)
    const required = requiredPhrase(input)
    const body = [
      `오늘은 ${focus}에 천천히 주의를 기울였습니다. ${required}을 따라 움직임 사이의 여백을 살펴보는 시간이었어요.`,
      `${memo} 몸이 보내는 신호를 서두르지 않고 바라보며, 각자의 범위 안에서 움직임을 이어갔습니다.`,
      "큰 동작보다 지금 느껴지는 감각에 집중하니 수련의 흐름도 한결 고요해졌습니다. 일상으로 돌아간 뒤에도 이 편안한 리듬을 잠시 기억해 보세요."
    ].join("\n\n")

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
      qualityChecks: { avoidedExpressionRemoved: !body.includes(input.avoid), includesRequiredPhrase: body.includes(required) }
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
