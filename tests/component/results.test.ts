import { fireEvent, render, screen } from "@testing-library/vue"
import { describe, expect, it } from "vitest"
import type { InstagramOutput } from "@/domain/studio"
import ResultEditor from "@/features/studio/ResultEditor.vue"
import { naverOutput } from "../fixtures"

const naver = {
  status: "success" as const,
  error: null,
  data: naverOutput
}

const failedInstagram = { status: "error" as const, error: "instagram unavailable", data: null }
const instagramOutput = {
  hookOptions: ["호흡으로 돌아온 저녁", "어깨의 감각을 살핀 시간", "차분하게 이어 간 수련"],
  captionLong: "호흡을 따라 어깨와 흉곽의 감각을 천천히 살폈습니다.",
  captionShort: "호흡과 함께한 오늘의 수련.",
  hashtags: ["#에이피요가", "#요가수련"],
  coverImageId: "",
  imageOrder: [],
  generationSource: "openai",
  qualityChecks: {}
} satisfies InstagramOutput
const successfulInstagram = { status: "success" as const, error: null, data: instagramOutput }
const review = { medicalClaims: [], repetitions: [], privacyWarnings: [], passed: true }
const fallbackNotice = "AI 연결이 불안정해 로컬 초안을 사용했어요."

function expectEnabledControl(label: string) {
  const control = screen.getByRole("button", { name: label }) as HTMLButtonElement
  expect(control.disabled).toBe(false)
}

describe("ResultEditor", () => {
  it("describes generated drafts without claiming every result is local demo output", () => {
    render(ResultEditor, { props: { naver, instagram: successfulInstagram, review, copyFallback: null } })

    expect(screen.getByText(/생성된 초안/)).toBeTruthy()
    expect(screen.queryByText(/로컬 데모 AI/)).toBeNull()
  })

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

  it("shows the fallback status only while the local Naver channel is active", async () => {
    render(ResultEditor, {
      props: {
        naver: { ...naver, data: { ...naverOutput, generationSource: "local-fallback" } },
        instagram: successfulInstagram,
        review,
        copyFallback: null
      }
    })

    expect(screen.getByRole("status").textContent).toContain(fallbackNotice)
    expect((screen.getByLabelText("본문 편집") as HTMLTextAreaElement).disabled).toBe(false)
    expectEnabledControl("도입부 감성 줄이기")
    expectEnabledControl("본문 복사")

    await fireEvent.click(screen.getByRole("tab", { name: "인스타그램" }))

    expect(screen.queryByText(fallbackNotice)).toBeNull()
    expect(screen.queryByRole("status")).toBeNull()
    expect((screen.getByLabelText("기본형 캡션") as HTMLTextAreaElement).disabled).toBe(false)
    expectEnabledControl("첫 문장 변경")
    expectEnabledControl("캡션 복사")
  })

  it("shows the fallback status only while the local Instagram channel is active", async () => {
    render(ResultEditor, {
      props: {
        naver,
        instagram: {
          ...successfulInstagram,
          data: { ...instagramOutput, generationSource: "local-fallback" }
        },
        review,
        copyFallback: null
      }
    })

    expect(screen.queryByText(fallbackNotice)).toBeNull()
    expect(screen.queryByRole("status")).toBeNull()
    expect((screen.getByLabelText("본문 편집") as HTMLTextAreaElement).disabled).toBe(false)
    expectEnabledControl("도입부 감성 줄이기")
    expectEnabledControl("본문 복사")

    await fireEvent.click(screen.getByRole("tab", { name: "인스타그램" }))

    expect(screen.getByRole("status").textContent).toContain(fallbackNotice)
    expect((screen.getByLabelText("기본형 캡션") as HTMLTextAreaElement).disabled).toBe(false)
    expectEnabledControl("첫 문장 변경")
    expectEnabledControl("캡션 복사")
  })
})
