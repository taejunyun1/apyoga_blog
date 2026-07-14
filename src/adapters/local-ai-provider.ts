import type {
  AnalyzeImagesInput,
  ChannelInput,
  RewriteInput,
  RewriteNaverTitleAndBodyInput,
  RewriteNaverTitleAndBodyOutput,
  RewriteOutput,
} from "@/domain/ports"
import type { ContentBrief, InstagramOutput, NaverOutput, ReviewOutput } from "@/domain/studio"
import {
  assertSafeRequiredPhrase,
  forbiddenExpressions,
  isSafePublishableCopy,
  sanitizeLocalFragment,
} from "@/domain/content-safety"
import { reviewText } from "@/domain/rules"

const NAVER_MIN_LENGTH = 500

function containsAvoidedExpression(text: string, avoid: string): boolean {
  return forbiddenExpressions(avoid).some((expression) => text.includes(expression))
}

function containsAvoidedExpressionIn(texts: string[], avoid: string): boolean {
  return texts.some((text) => containsAvoidedExpression(text, avoid))
}

function detectBodyFocus(memo: string): string[] {
  const candidates = ["어깨", "흉곽", "척추", "골반", "고관절", "햄스트링", "목", "등", "코어"]
  const matches = candidates.filter((candidate) => memo.includes(candidate))
  return matches.length > 0 ? matches : ["호흡", "전신"]
}

function hashtags(bodyFocus: string[], avoid: string): string[] {
  return ["#에이피요가", "#요가수련", "#오늘의요가", ...bodyFocus.map((focus) => `#${focus}요가`), "#호흡", "#마음챙김", "#요가기록", "#편안한움직임"]
    .map((value) => sanitizeLocalFragment(value, avoid))
    .filter((value) => value.startsWith("#") && value.length > 1)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 8)
}

function safeAlternative(values: string[], avoid: string): string {
  return values.find((value) => sanitizeLocalFragment(value, avoid) === value) ?? ""
}

function differentSafeText(candidates: string[], currentText: string, avoid: string): string {
  const current = currentText.trim()
  const next = candidates
    .map((candidate) => sanitizeLocalFragment(candidate, avoid))
    .find((candidate) => candidate && candidate.trim() !== current && isSafePublishableCopy([candidate], avoid))
  if (!next) throw new Error("이전과 다른 안전한 문구를 만들 수 없어요.")
  return next
}

function requiredPhrase(input: AnalyzeImagesInput): string {
  const required = assertSafeRequiredPhrase(input.mustInclude, input.avoid)
  if (required) return required
  const fallback = safeAlternative(["호흡", "몸의 감각", "현재의 리듬", "편안한 관찰"], input.avoid)
  if (!fallback) throw new Error("금지 표현을 제외하고 안전한 필수 표현을 만들 수 없어요.")
  return fallback
}

function safeFocuses(input: ChannelInput): string[] {
  const focuses = input.brief.bodyFocus
    .map((focus) => sanitizeLocalFragment(focus, input.avoid))
    .filter(Boolean)
  if (focuses.length > 0) return [...new Set(focuses)]
  const fallback = safeAlternative(["전신", "몸", "움직임", "자세"], input.avoid)
  if (!fallback) throw new Error("금지 표현을 제외하고 안전한 신체 초점을 만들 수 없어요.")
  return [fallback]
}

function safeImageDescriptions(input: ChannelInput): Array<{ imageId: string; description: string }> {
  return input.brief.imageDescriptions
    .map(({ imageId, description }) => ({ imageId, description: sanitizeLocalFragment(description, input.avoid) }))
    .filter(({ description }) => description.length >= 4 && isSafePublishableCopy([description], input.avoid))
}

function emotionalVisualParagraphs(input: ChannelInput): string[] {
  const mood = sanitizeLocalFragment(input.brief.overallMood, input.avoid) || "차분한"
  return safeImageDescriptions(input).map(({ description }, index) => {
    const detail = description
      .replace(/^\s*(?:\d+|첫|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*번째\s*(?:사진|수련)?\s*/u, "")
      .replace(/^\s*(?:사진|이미지)\s*(?:속|에는|은|는|에서|에|을|를|으로는?)?\s*/u, "")
      .trim()
    return index % 2 === 0
      ? `${detail}에서 느껴지는 빛과 색의 결이 ${mood} 호흡과 어우러져 오늘 수련의 여운을 부드럽게 남겼습니다.`
      : `${detail}의 공간감은 서두르지 않는 움직임과 이어져, 몸과 마음이 천천히 제자리로 돌아오는 여운을 전해 주었습니다.`
  })
}

function naverBody(input: ChannelInput, focus: string, required: string): string {
  const memo = sanitizeLocalFragment(input.memo, input.avoid)
    || safeAlternative(["오늘의 수련을 차분히 돌아보았습니다.", "함께한 움직임을 천천히 기록했습니다."], input.avoid)
  const visualParagraphs = emotionalVisualParagraphs(input)
  const paragraphs = [
    `오늘은 ${focus}에 천천히 주의를 기울이며 수련을 시작했습니다. ${required}을 따라 서두르지 않고 몸과 마음이 현재에 도착할 시간을 충분히 두었습니다.`,
    `${memo}라는 기록을 바탕으로 각 동작의 크기보다 움직임이 이어지는 과정과 그 사이의 여백을 살펴보았습니다.`,
    ...visualParagraphs,
    `숨을 들이쉴 때와 내쉴 때 달라지는 감각을 관찰하며 ${focus} 주변의 긴장을 억지로 밀어내지 않고 각자의 편안한 범위 안에서 움직였습니다.`,
    "공간에 번진 빛과 소도구의 색은 호흡의 속도와 자연스럽게 어우러졌습니다. 눈에 머문 작은 결을 따라가니 수련 뒤의 고요도 한층 오래 이어졌습니다.",
    "수련이 깊어질수록 큰 변화보다 작고 분명한 신호를 알아차리는 일이 중요하다는 것을 다시 확인했습니다. 잠시 쉬는 선택도 오늘의 몸에 맞는 좋은 움직임이 될 수 있습니다.",
    "마무리에서는 처음과 달라진 호흡과 바닥에 닿는 감각을 천천히 확인했습니다. 일상으로 돌아간 뒤에도 오늘 발견한 편안한 리듬을 짧게 떠올려 보세요.",
    `호흡의 길이를 일부러 바꾸기보다 자연스럽게 이어지는 흐름을 지켜보았습니다. 들숨과 날숨 사이에 생기는 작은 쉼도 수련의 일부로 받아들였습니다.`,
    `동작을 옮길 때에는 발과 손이 바닥을 누르는 감각을 확인했습니다. 안정된 지점을 찾은 뒤 다음 움직임을 선택하니 몸의 반응을 더 또렷하게 알아차릴 수 있었습니다.`,
    `A.P YOGA는 정답처럼 보이는 자세보다 자신의 ${focus} 감각을 세심하게 알아차리는 과정을 소중히 여깁니다.`,
    `다음 수련에서도 ${required}으로 돌아오며 오늘의 경험을 차분히 이어가겠습니다. 익숙한 동작에서도 새로운 느낌이 있는지 천천히 살펴보겠습니다.`,
    "수업을 떠올릴 때에는 잘한 동작을 고르기보다 어느 순간 숨이 편안해졌는지 기억해 보아도 좋습니다. 그 기억은 다음 움직임을 선택하는 단서가 됩니다.",
    "매트 밖에서도 잠깐 멈춰 서서 발바닥이 바닥에 닿는 느낌을 확인해 보세요. 짧은 관찰만으로도 바쁜 흐름에서 자신의 속도를 다시 찾을 수 있습니다.",
    "다음에 같은 동작을 만나더라도 오늘과 똑같이 할 필요는 없습니다. 그날의 상태를 먼저 살피고 가능한 범위를 새롭게 정하는 것이 자연스럽습니다.",
    "함께한 사람들의 서로 다른 속도는 수련에 한 가지 답만 있는 것이 아님을 보여주었습니다. 비교보다 관찰에 머물 때 각자의 경험이 더욱 선명해집니다.",
    "작은 메모를 남겨 두면 지나치기 쉬운 변화를 다음 수업에서 다시 만날 수 있습니다. 편안했던 순간과 잠시 쉬고 싶었던 순간을 함께 적어 보세요.",
    "편안함의 기준은 날마다 달라질 수 있으므로 어제의 범위를 그대로 따르지 않아도 괜찮습니다. 지금 확인한 신호를 기준으로 다음 선택을 이어가면 됩니다."
  ]
  const safeParagraphs = paragraphs
    .map((paragraph) => sanitizeLocalFragment(paragraph, input.avoid))
    .filter((paragraph) => paragraph.length >= 12)
    .filter((paragraph, index, values) => values.indexOf(paragraph) === index)
  const selected: string[] = []

  for (const paragraph of safeParagraphs) {
    selected.push(paragraph)
    if (selected.join("\n\n").trim().length >= NAVER_MIN_LENGTH) break
  }

  const body = selected.join("\n\n").trim()
  if (body.length < NAVER_MIN_LENGTH) {
    throw new Error("금지 표현을 제외하면 의미 있는 네이버 본문 500자를 만들 수 없어요.")
  }
  return body
}

export class LocalAIProvider {
  async analyzeImages(input: AnalyzeImagesInput): Promise<ContentBrief> {
    const cleanedMemo = sanitizeLocalFragment(input.memo, input.avoid)
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
    const focuses = safeFocuses(input)
    const focus = focuses.join("과 ")
    const required = requiredPhrase(input)
    const body = naverBody(input, focus, required)
    const titles = [
      `${focus}, 오늘의 요가 수련 기록`,
      `${required}과 함께 천천히 돌아본 시간`,
      "몸의 감각을 깨우는 A.P YOGA 수련"
    ].map((copy) => sanitizeLocalFragment(copy, input.avoid))
    const introOptions = [
      `${sanitizeLocalFragment(input.brief.overallMood, input.avoid) || "차분한 분위기"} 속에서 오늘의 수련을 시작했습니다.`,
      `바쁜 하루 끝, ${required}에 잠시 머물렀습니다.`,
      `${focus}의 감각을 차분하게 살펴본 시간이었어요.`
    ].map((copy) => sanitizeLocalFragment(copy, input.avoid))
    const descriptions = new Map(safeImageDescriptions(input).map((item) => [item.imageId, item.description]))
    const imagePlacements = input.brief.recommendedImageOrder.map((imageId, index) => ({
      imageId,
      afterParagraph: Math.min(index + 1, 3),
      caption: descriptions.get(imageId) ?? sanitizeLocalFragment(`${focus}의 감각을 살펴보는 수련 장면`, input.avoid)
    }))
    const outputHashtags = hashtags(focuses, input.avoid)
    const classInfo = sanitizeLocalFragment("수업·예약 정보는 게시 전에 최신 내용을 확인해 주세요.", input.avoid)
    const publishableText = [
      ...titles,
      ...introOptions,
      body,
      ...imagePlacements.map((placement) => placement.caption),
      ...outputHashtags,
      classInfo
    ]
    if (titles.some((copy) => !copy) || introOptions.some((copy) => !copy)
      || imagePlacements.some((placement) => !placement.caption) || !classInfo
      || !isSafePublishableCopy(publishableText, input.avoid) || !body.includes(required)) {
      throw new Error("금지 표현을 제외하고 안전한 네이버 초안을 만들 수 없어요.")
    }

    return {
      titles,
      introOptions,
      body,
      imagePlacements,
      hashtags: outputHashtags,
      classInfo,
      generationSource: "local-fallback",
      qualityChecks: {
        avoidedExpressionRemoved: !containsAvoidedExpressionIn(publishableText, input.avoid),
        includesRequiredPhrase: body.includes(required)
      }
    }
  }

  async generateInstagram(input: ChannelInput): Promise<InstagramOutput> {
    const focuses = safeFocuses(input)
    const focus = focuses.join("과 ")
    const required = requiredPhrase(input)
    const visualMood = emotionalVisualParagraphs(input).join(" ")
    const captionLong = sanitizeLocalFragment(
      `오늘의 수련은 ${focus}에서 시작했습니다.\n\n${visualMood}\n\n${required}을 따라 천천히 움직이며, 몸이 건네는 작은 신호에 귀 기울였어요. 완벽한 모양보다 지금의 감각에 머무는 시간. 오늘의 고요를 일상에도 가볍게 이어가 보세요.`,
      input.avoid
    )
    const captionShort = sanitizeLocalFragment(`${focus}의 감각을 깨우며 ${required}에 머문 오늘의 수련.`, input.avoid)
    const hookOptions = ["몸이 먼저 알아차린 작은 변화", `${required}으로 돌아오는 시간`, `오늘은 ${focus}에서 시작했어요`]
      .map((copy) => sanitizeLocalFragment(copy, input.avoid))
    const outputHashtags = hashtags(focuses, input.avoid)
    const publishableText = [...hookOptions, captionLong, captionShort, ...outputHashtags]
    if (hookOptions.some((copy) => !copy) || !captionLong || !captionShort
      || !isSafePublishableCopy(publishableText, input.avoid)
      || !captionLong.includes(required)) {
      throw new Error("금지 표현을 제외하고 안전한 인스타그램 초안을 만들 수 없어요.")
    }

    return {
      hookOptions,
      captionLong,
      captionShort,
      hashtags: outputHashtags,
      coverImageId: input.brief.recommendedCoverImageId,
      imageOrder: input.brief.recommendedImageOrder,
      generationSource: "local-fallback",
      qualityChecks: { avoidedExpressionRemoved: !containsAvoidedExpressionIn(publishableText, input.avoid) }
    }
  }

  async rewriteSection(input: RewriteInput): Promise<RewriteOutput> {
    if (input.channel === "naver" && input.section === "body") {
      const current = input.currentText.trim()
      if (current.length < NAVER_MIN_LENGTH) {
        throw new Error("네이버 본문 재작성은 500자 이상의 기존 본문이 필요해요.")
      }
      if (!isSafePublishableCopy([current], input.avoid)) {
        throw new Error("금지 표현 또는 의료적 단정이 있는 본문은 안전하게 재작성할 수 없어요.")
      }
      const rawAdditions = input.instruction.includes("사진 분위기")
        ? [
            "공간에 스민 빛과 소도구의 색이 호흡의 리듬과 어우러지며, 수련이 끝난 뒤에도 잔잔한 여운을 남겼습니다.",
            "눈에 머문 색감과 바닥의 결을 따라 오늘의 움직임을 돌아보니, 고요한 순간이 일상으로 천천히 이어지는 듯했습니다."
          ]
        : [
            "이번 기록은 추상적인 해석보다 발바닥이 바닥에 닿는 느낌과 호흡의 속도처럼 수업에서 직접 관찰한 장면을 중심으로 담았습니다.",
            "큰 의미를 덧붙이기보다 움직임의 순서와 잠시 멈춘 순간처럼 수업에서 확인한 사실을 담백하게 정리했습니다."
          ]
      const additions = rawAdditions.map((addition) => sanitizeLocalFragment(addition, input.avoid)).filter(Boolean)
      const addition = additions.find((candidate) => !current.includes(candidate))
      if (!addition) throw new Error("이전과 다른 안전한 문구를 만들 수 없어요.")
      const rewritten = `${current}\n\n${addition}`
      if (!isSafePublishableCopy([rewritten], input.avoid)) {
        throw new Error("금지 표현을 제외하고 안전한 네이버 본문을 재작성할 수 없어요.")
      }
      return { section: input.section, text: rewritten }
    }
    const memoFocus = detectBodyFocus(input.memo).join("과 ")
    const focusTags = hashtags(detectBodyFocus(input.memo), input.avoid)
    let candidates: string[]
    if (input.channel === "naver" && input.section === "title") {
      candidates = [
        `${memoFocus}, 호흡으로 돌아본 오늘의 수련`,
        `A.P YOGA에서 천천히 살핀 ${memoFocus}`,
        `${memoFocus}의 감각을 기록한 요가 시간`
      ]
    } else if (input.channel === "naver" && input.section === "intro") {
      candidates = [
        `담백하게 정리하면, 오늘은 ${memoFocus}의 움직임과 호흡을 차례로 살폈습니다.`,
        `${memoFocus}에 주의를 기울이며 차분하게 수련을 시작했습니다.`,
        `오늘의 몸 상태를 확인한 뒤 ${memoFocus}의 감각을 천천히 따라갔습니다.`
      ]
    } else if (input.channel === "instagram" && input.section === "hook") {
      candidates = [
        `${memoFocus}의 감각에서 시작한 오늘`,
        "호흡을 따라 천천히 돌아온 시간",
        `오늘은 ${memoFocus}에 주의를 기울였어요`
      ]
    } else if (input.channel === "instagram" && input.section === "short") {
      candidates = [
        `${memoFocus}와 호흡을 차분히 살핀 오늘의 수련.`,
        "서두르지 않고 몸의 신호를 따라간 시간.",
        `오늘의 ${memoFocus} 감각을 짧게 기록해요.`
      ]
    } else if (input.channel === "instagram" && input.section === "hashtags") {
      candidates = [
        focusTags.join(" "),
        [...focusTags.slice(1), focusTags[0]].filter(Boolean).join(" ")
      ]
    } else {
      candidates = [
        `${memoFocus}의 감각을 따라 천천히 움직이며 호흡의 변화를 살폈습니다.`,
        `오늘은 ${memoFocus}에 주의를 기울이고 각자의 편안한 속도로 수련을 이어갔습니다.`
      ]
    }
    const text = differentSafeText(candidates, input.currentText, input.avoid)
    return {
      section: input.section,
      text
    }
  }

  async rewriteNaverTitleAndBody(
    input: RewriteNaverTitleAndBodyInput,
  ): Promise<RewriteNaverTitleAndBodyOutput> {
    const currentTitle = input.currentTitle.trim()
    const currentBody = input.currentBody.trim()
    if (!currentTitle || !currentBody || currentBody.length < NAVER_MIN_LENGTH) {
      throw new Error("네이버 제목과 500자 이상의 본문이 필요해요.")
    }
    if (!isSafePublishableCopy([currentTitle, currentBody], input.avoid)) {
      throw new Error("금지 표현 또는 의료적 단정이 있는 문구는 안전하게 재작성할 수 없어요.")
    }

    const memo = `${input.memo}\n${input.photoContext}`
    const [title, body] = await Promise.all([
      this.rewriteSection({
        channel: "naver",
        section: "title",
        currentText: currentTitle,
        instruction: input.instruction,
        memo,
        avoid: input.avoid,
        tone: input.tone,
      }),
      this.rewriteSection({
        channel: "naver",
        section: "body",
        currentText: currentBody,
        instruction: "사진 분위기 더하기",
        memo,
        avoid: input.avoid,
        tone: input.tone,
      }),
    ])

    if (!title.text.trim() || !body.text.trim() || body.text.trim().length < NAVER_MIN_LENGTH
      || !isSafePublishableCopy([title.text, body.text], input.avoid)) {
      throw new Error("안전한 제목과 본문을 함께 만들지 못했어요.")
    }
    return { title: title.text.trim(), body: body.text.trim() }
  }

  async review(input: { text: string }): Promise<ReviewOutput> {
    return reviewText(input.text)
  }
}
