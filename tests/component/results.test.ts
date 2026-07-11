import { fireEvent, render, screen } from "@testing-library/vue"
import { describe, expect, it } from "vitest"
import ResultEditor from "@/features/studio/ResultEditor.vue"

const naver = {
  status: "success" as const,
  error: null,
  data: {
    titles: ["호흡과 함께한 저녁 수련", "어깨를 여는 시간", "오늘의 요가 기록"],
    introOptions: ["차분한 저녁 수련을 시작했습니다.", "호흡으로 돌아옵니다.", "몸의 감각을 살펴봅니다."],
    body: "오늘은 어깨와 흉곽에 천천히 주의를 기울였습니다.",
    imagePlacements: [],
    hashtags: ["#에이피요가", "#요가수련"],
    classInfo: "예약 정보 확인",
    qualityChecks: {}
  }
}

const failedInstagram = { status: "error" as const, error: "instagram unavailable", data: null }
const review = { medicalClaims: [], repetitions: [], privacyWarnings: [], passed: true }

describe("ResultEditor", () => {
  it("keeps Naver visible and retries only failed Instagram", async () => {
    const { emitted } = render(ResultEditor, { props: { naver, instagram: failedInstagram, review, copyFallback: null } })

    expect(screen.getByText("네이버 글이 준비됐어요")).toBeTruthy()
    await fireEvent.click(screen.getByRole("tab", { name: "인스타그램" }))
    await fireEvent.click(screen.getByRole("button", { name: "인스타그램만 다시 생성" }))
    expect(emitted()["retry-channel"]?.[0]).toEqual(["instagram"])
  })

  it("requests only a selected-section rewrite", async () => {
    const { emitted } = render(ResultEditor, { props: { naver, instagram: failedInstagram, review, copyFallback: null } })
    await fireEvent.click(screen.getByRole("button", { name: "도입부 감성 줄이기" }))

    expect(emitted().rewrite?.[0]).toEqual([{ channel: "naver", section: "intro", instruction: "감성 줄이기" }])
  })

  it("emits the selected title so copy uses the chosen option", async () => {
    const { emitted } = render(ResultEditor, { props: { naver, instagram: failedInstagram, review, copyFallback: null } })
    await fireEvent.click(screen.getByLabelText("어깨를 여는 시간"))

    expect(emitted()["select-option"]?.[0]).toEqual([{ channel: "naver", kind: "title", index: 1 }])
  })

  it("shows selectable text when clipboard copy fails", () => {
    render(ResultEditor, { props: { naver, instagram: failedInstagram, review, copyFallback: "복사할 전체 글" } })

    expect(screen.getByText("길게 눌러 복사해 주세요")).toBeTruthy()
    expect((screen.getByLabelText("직접 복사할 글") as HTMLTextAreaElement).value).toBe("복사할 전체 글")
  })
})
