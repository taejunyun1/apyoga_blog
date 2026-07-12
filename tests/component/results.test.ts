import { fireEvent, render, screen } from "@testing-library/vue"
import { describe, expect, it } from "vitest"
import ResultEditor from "@/features/studio/ResultEditor.vue"
import { naverOutput } from "../fixtures"

const naver = {
  status: "success" as const,
  error: null,
  data: naverOutput
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

  it("announces a successful copy to assistive technology", () => {
    render(ResultEditor, { props: { naver, instagram: failedInstagram, review, copyFallback: null, copyStatus: "클립보드에 복사했어요" } })

    expect(screen.getByRole("status").textContent).toContain("클립보드에 복사했어요")
  })

  it("explains a local fallback without hiding the generated result", () => {
    render(ResultEditor, {
      props: {
        naver: { ...naver, data: { ...naverOutput, generationSource: "local-fallback" } },
        instagram: failedInstagram,
        review,
        copyFallback: null
      }
    })

    expect(screen.getByText("AI 연결이 불안정해 로컬 초안을 사용했어요.")).toBeTruthy()
    expect(screen.getByLabelText("본문 편집")).toBeTruthy()
    expect(screen.getByRole("button", { name: "본문 복사" })).toBeTruthy()
  })
})
