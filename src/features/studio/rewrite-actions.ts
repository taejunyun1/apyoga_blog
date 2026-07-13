export type RewriteChannel = "naver" | "instagram"

export interface RewriteRequest {
  channel: RewriteChannel
  section: string
  instruction: string
}

export interface RewritePreview {
  section: string
  label: string
  text: string
}

interface RewriteAction extends RewriteRequest {
  label: string
  accessibleLabel?: string
  feedback: {
    preview: string
    toast: string
  }
}

export const rewriteActions: readonly RewriteAction[] = [
  { channel: "naver", section: "intro", instruction: "감성 줄이기", label: "감성 줄이기", accessibleLabel: "도입부 감성 줄이기", feedback: { preview: "도입부", toast: "도입부의 감성을 줄였어요" } },
  { channel: "naver", section: "body", instruction: "철학 줄이기", label: "철학 줄이기", feedback: { preview: "네이버 본문", toast: "본문의 철학적 표현을 줄였어요" } },
  { channel: "naver", section: "body", instruction: "사진 설명 늘리기", label: "사진 설명 늘리기", feedback: { preview: "네이버 본문", toast: "사진 설명을 보강했어요" } },
  { channel: "naver", section: "title", instruction: "최근 글과 다르게", label: "최근 글과 다르게", feedback: { preview: "새 제목", toast: "새 제목을 만들었어요" } },
  { channel: "instagram", section: "hook", instruction: "첫 문장만 변경", label: "첫 문장 변경", feedback: { preview: "첫 문장", toast: "첫 문장을 변경했어요" } },
  { channel: "instagram", section: "short", instruction: "더 짧게", label: "더 짧게", feedback: { preview: "짧은 캡션", toast: "캡션을 더 짧게 만들었어요" } },
  { channel: "instagram", section: "hashtags", instruction: "해시태그 변경", label: "해시태그 변경", feedback: { preview: "해시태그", toast: "해시태그를 변경했어요" } }
]

export function rewriteActionsFor(channel: RewriteChannel) {
  return rewriteActions.filter((action) => action.channel === channel)
}

export function rewriteActionKey(request: RewriteRequest): string {
  return `${request.channel}:${request.section}:${request.instruction}`
}

export function rewriteFeedbackFor(request: RewriteRequest): RewriteAction["feedback"] {
  const key = rewriteActionKey(request)
  const action = rewriteActions.find((candidate) => rewriteActionKey(candidate) === key)
  if (!action) throw new Error("지원하지 않는 부분 다시 쓰기 요청입니다.")
  return action.feedback
}
