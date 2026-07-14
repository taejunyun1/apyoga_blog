import { describe, expect, it } from "vitest"
import { rewriteActionKey, rewriteActions, rewriteFeedbackFor } from "@/features/studio/rewrite-actions"

const expectedFeedback = [
  [{ channel: "naver", section: "intro", instruction: "감성 줄이기" }, { preview: "도입부", toast: "도입부의 감성을 줄였어요" }],
  [{ channel: "naver", section: "body", instruction: "철학 줄이기" }, { preview: "네이버 본문", toast: "본문의 철학적 표현을 줄였어요" }],
  [{ channel: "naver", section: "body", instruction: "사진 분위기 더하기" }, { preview: "네이버 본문", toast: "사진의 분위기를 보강했어요" }],
  [{ channel: "naver", section: "titleAndBody", instruction: "최근 글과 다르게" }, { preview: "새 제목과 본문", toast: "제목과 본문을 새롭게 만들었어요" }],
  [{ channel: "instagram", section: "hook", instruction: "첫 문장만 변경" }, { preview: "첫 문장", toast: "첫 문장을 변경했어요" }],
  [{ channel: "instagram", section: "short", instruction: "더 짧게" }, { preview: "짧은 캡션", toast: "캡션을 더 짧게 만들었어요" }],
  [{ channel: "instagram", section: "hashtags", instruction: "해시태그 변경" }, { preview: "해시태그", toast: "해시태그를 변경했어요" }]
] as const

describe("rewrite action feedback", () => {
  it("keeps exactly the seven action mappings used by the UI", () => {
    expect(rewriteActions).toHaveLength(7)
    expect(rewriteActions.map(({ channel, section, instruction }) => ({ channel, section, instruction })))
      .toEqual(expectedFeedback.map(([request]) => request))
  })

  it.each(expectedFeedback)("maps $channel:$section:$instruction to its exact feedback", (request, feedback) => {
    expect(rewriteActionKey(request)).toBe(`${request.channel}:${request.section}:${request.instruction}`)
    expect(rewriteFeedbackFor(request)).toEqual(feedback)
  })
})
