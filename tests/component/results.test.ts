import { fireEvent, render, screen } from "@testing-library/vue"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import type { InstagramOutput } from "@/domain/studio"
import ResultEditor from "@/features/studio/ResultEditor.vue"
import { naverOutput, studioImages } from "../fixtures"

const naver = {
  status: "success" as const,
  error: null,
  data: naverOutput
}

const failedNaver = { status: "error" as const, error: "naver unavailable", data: null }
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
const images = studioImages(3)
const rewriteProps = {
  pendingRewriteKey: null,
  rewritePreviews: {}
}

function expectEnabledControl(label: string) {
  const control = screen.getByRole("button", { name: label }) as HTMLButtonElement
  expect(control.disabled).toBe(false)
}

describe("ResultEditor", () => {
  it("describes generated drafts without claiming every result is local demo output", () => {
    render(ResultEditor, { props: { naver, instagram: successfulInstagram, review, copyFallback: null, images, ...rewriteProps } })

    expect(screen.getByText(/생성된 초안/)).toBeTruthy()
    expect(screen.queryByText(/로컬 데모 AI/)).toBeNull()
  })

  it("keeps Naver visible and retries only failed Instagram", async () => {
    const { emitted } = render(ResultEditor, { props: { naver, instagram: failedInstagram, review, copyFallback: null, images, ...rewriteProps } })

    expect(screen.getByText("네이버 글이 준비됐어요")).toBeTruthy()
    await fireEvent.click(screen.getByRole("tab", { name: "인스타그램" }))
    await fireEvent.click(screen.getByRole("button", { name: "인스타그램만 다시 생성" }))
    expect(emitted()["retry-channel"]?.[0]).toEqual(["instagram"])
  })

  it("requests only a selected-section rewrite", async () => {
    const { emitted } = render(ResultEditor, { props: { naver, instagram: failedInstagram, review, copyFallback: null, images, ...rewriteProps } })
    await fireEvent.click(screen.getByRole("button", { name: "도입부 감성 줄이기" }))

    expect(emitted().rewrite?.[0]).toEqual([{ channel: "naver", section: "intro", instruction: "감성 줄이기" }])
  })

  it("emits the selected title so copy uses the chosen option", async () => {
    const { emitted } = render(ResultEditor, { props: { naver, instagram: failedInstagram, review, copyFallback: null, images, ...rewriteProps } })
    await fireEvent.click(screen.getByLabelText("어깨를 여는 시간"))

    expect(emitted()["select-option"]?.[0]).toEqual([{ channel: "naver", kind: "title", index: 1 }])
  })

  it("keeps the option moved to the copy position visibly selected", async () => {
    const view = render(ResultEditor, { props: { naver, instagram: failedInstagram, review, copyFallback: null, images, ...rewriteProps } })
    const chosen = naverOutput.titles[1]

    await fireEvent.click(screen.getByLabelText(chosen))
    await view.rerender({
      naver: {
        ...naver,
        data: {
          ...naverOutput,
          titles: [chosen, naverOutput.titles[0], naverOutput.titles[2]]
        }
      },
      instagram: failedInstagram,
      review,
      copyFallback: null,
      images,
      ...rewriteProps
    })

    expect((screen.getByLabelText(chosen) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText(naverOutput.titles[0]) as HTMLInputElement).checked).toBe(false)
  })

  it("requests simple feedback for channel and direct-text changes", async () => {
    const { emitted } = render(ResultEditor, { props: { naver, instagram: successfulInstagram, review, copyFallback: null, images, ...rewriteProps } })

    await fireEvent.click(screen.getByRole("tab", { name: "인스타그램" }))
    await fireEvent.update(screen.getByLabelText("기본형 캡션"), "직접 수정한 캡션")
    await fireEvent.change(screen.getByLabelText("기본형 캡션"))

    expect(emitted().notify).toEqual([
      ["인스타그램 결과를 열었어요"]
    ])
    expect(emitted().edit?.[0]).toEqual([{ channel: "instagram", section: "caption", text: "직접 수정한 캡션" }])
    expect(instagramOutput.captionLong).not.toBe("직접 수정한 캡션")
  })

  it("shows selectable text when clipboard copy fails", () => {
    render(ResultEditor, { props: { naver, instagram: failedInstagram, review, copyFallback: "복사할 전체 글", images, ...rewriteProps } })

    expect(screen.getByText("길게 눌러 복사해 주세요")).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
    expect((screen.getByLabelText("직접 복사할 글") as HTMLTextAreaElement).value).toBe("복사할 전체 글")
  })

  it("shows the fallback status only while the local Naver channel is active", async () => {
    render(ResultEditor, {
      props: {
        naver: { ...naver, data: { ...naverOutput, generationSource: "local-fallback" } },
        instagram: successfulInstagram,
        review,
        copyFallback: null,
        images,
        ...rewriteProps
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
        copyFallback: null,
        images,
        ...rewriteProps
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

  it("connects channel copy to its thumbnail order", async () => {
    render(ResultEditor, {
      props: {
        naver: {
          ...naver,
          data: {
            ...naverOutput,
            imagePlacements: [
              { imageId: "image-2", afterParagraph: 4, caption: "호흡을 마무리하는 장면" },
              { imageId: "image-1", afterParagraph: 1, caption: "수련을 여는 장면" }
            ]
          }
        },
        instagram: {
          ...successfulInstagram,
          data: {
            ...instagramOutput,
            imageOrder: ["image-3", "image-1", "image-2"],
            coverImageId: "image-3"
          }
        },
        review,
        copyFallback: null,
        images,
        ...rewriteProps
      }
    })

    const naverMap = screen.getByRole("region", { name: "사진과 글 배치" })
    expect(naverMap.querySelectorAll("li")[0].textContent).toContain("문단 1 뒤")
    expect(screen.getByRole("img", { name: "수련을 여는 장면" }).getAttribute("src")).toBe("blob:photo-1")

    await fireEvent.click(screen.getByRole("tab", { name: "인스타그램" }))

    const instagramMap = screen.getByRole("region", { name: "사진 게시 순서" })
    expect(instagramMap.querySelectorAll("li")[0].textContent).toContain("1번째")
    expect(instagramMap.querySelectorAll("li")[0].textContent).toContain("대표 사진")
    expect(screen.getByRole("img", { name: "1번째 사진 photo-3.jpg" }).getAttribute("src")).toBe("blob:photo-3")
  })

  it("disables every rewrite action and labels the active request while rewriting", () => {
    render(ResultEditor, {
      props: {
        naver,
        instagram: successfulInstagram,
        images,
        review,
        copyFallback: null,
        pendingRewriteKey: "naver:body:사진 설명 늘리기",
        rewritePreviews: {}
      }
    })

    const activeRequest = screen.getByRole("button", { name: "사진 설명 늘리기 변경 중…" })
    expect((activeRequest as HTMLButtonElement).disabled).toBe(true)
    expect(activeRequest.getAttribute("aria-busy")).toBe("true")
    expect((screen.getByRole("button", { name: "도입부 감성 줄이기" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it.each([
    {
      name: "Naver",
      naverResult: failedNaver,
      instagramResult: successfulInstagram,
      tab: null,
      retryLabel: "네이버만 다시 생성"
    },
    {
      name: "Instagram",
      naverResult: naver,
      instagramResult: failedInstagram,
      tab: "인스타그램",
      retryLabel: "인스타그램만 다시 생성"
    }
  ])("disables and restores the $name retry while rewriting", async ({ naverResult, instagramResult, tab, retryLabel }) => {
    const user = userEvent.setup()
    const view = render(ResultEditor, {
      props: {
        naver: naverResult,
        instagram: instagramResult,
        images,
        review,
        copyFallback: null,
        pendingRewriteKey: "naver:intro:감성 줄이기",
        rewritePreviews: {}
      }
    })
    if (tab) await user.click(screen.getByRole("tab", { name: tab }))

    const retry = screen.getByRole("button", { name: retryLabel }) as HTMLButtonElement
    expect(retry.disabled).toBe(true)
    await user.click(retry)
    expect(view.emitted()["retry-channel"]).toBeUndefined()

    await view.rerender({
      naver: naverResult,
      instagram: instagramResult,
      images,
      review,
      copyFallback: null,
      pendingRewriteKey: null,
      rewritePreviews: {}
    })
    expect((screen.getByRole("button", { name: retryLabel }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("disables only result mutations in both channels while a rewrite is pending", async () => {
    const pendingRewriteKey = "naver:body:사진 설명 늘리기"
    const view = render(ResultEditor, {
      props: {
        naver,
        instagram: successfulInstagram,
        images,
        review,
        copyFallback: null,
        pendingRewriteKey,
        rewritePreviews: {}
      }
    })

    expect((screen.getByLabelText("본문 편집") as HTMLTextAreaElement).disabled).toBe(true)
    expect((screen.getAllByRole("radio") as HTMLInputElement[]).every((radio) => radio.disabled)).toBe(true)
    expect((screen.getByRole("button", { name: "작성 이력에 저장" }) as HTMLButtonElement).disabled).toBe(true)
    const naverCopy = screen.getByRole("button", { name: "본문 복사" }) as HTMLButtonElement
    expect(naverCopy.disabled).toBe(false)
    expect((screen.getByRole("tab", { name: "인스타그램" }) as HTMLButtonElement).disabled).toBe(false)

    await fireEvent.click(naverCopy)
    expect(view.emitted().copy?.[0]).toEqual([{ channel: "naver", part: "body" }])

    await fireEvent.click(screen.getByRole("tab", { name: "인스타그램" }))

    expect((screen.getByLabelText("기본형 캡션") as HTMLTextAreaElement).disabled).toBe(true)
    expect((screen.getByLabelText("짧은 캡션") as HTMLTextAreaElement).disabled).toBe(true)
    expect((screen.getAllByRole("radio") as HTMLInputElement[]).every((radio) => radio.disabled)).toBe(true)
    expect((screen.getByRole("button", { name: "캡션 복사" }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole("tab", { name: "네이버 블로그" }) as HTMLButtonElement).disabled).toBe(false)

    await view.rerender({
      naver,
      instagram: successfulInstagram,
      images,
      review,
      copyFallback: null,
      pendingRewriteKey: null,
      rewritePreviews: {}
    })

    expect((screen.getByLabelText("기본형 캡션") as HTMLTextAreaElement).disabled).toBe(false)
    expect((screen.getByLabelText("짧은 캡션") as HTMLTextAreaElement).disabled).toBe(false)
    expect((screen.getAllByRole("radio") as HTMLInputElement[]).every((radio) => !radio.disabled)).toBe(true)
    expect((screen.getByRole("button", { name: "작성 이력에 저장" }) as HTMLButtonElement).disabled).toBe(false)

    await fireEvent.click(screen.getByRole("tab", { name: "네이버 블로그" }))
    expect((screen.getByLabelText("본문 편집") as HTMLTextAreaElement).disabled).toBe(false)
    expect((screen.getAllByRole("radio") as HTMLInputElement[]).every((radio) => !radio.disabled)).toBe(true)
  })

  it("shows each channel's last rewritten text directly below its actions", async () => {
    render(ResultEditor, {
      props: {
        naver,
        instagram: successfulInstagram,
        images,
        review,
        copyFallback: null,
        pendingRewriteKey: null,
        rewritePreviews: {
          naver: { section: "title", label: "새 제목", text: "호흡과 감각을 따라간 수련" },
          instagram: { section: "short", label: "짧은 캡션", text: "천천히 호흡한 수련." }
        }
      }
    })

    expect(screen.getByText("최근 변경 · 새 제목")).toBeTruthy()
    expect(screen.getByText("호흡과 감각을 따라간 수련")).toBeTruthy()

    await fireEvent.click(screen.getByRole("tab", { name: "인스타그램" }))
    expect(screen.getByText("최근 변경 · 짧은 캡션")).toBeTruthy()
    expect(screen.getByText("천천히 호흡한 수련.")).toBeTruthy()

    await fireEvent.click(screen.getByRole("tab", { name: "네이버 블로그" }))
    expect(screen.getByText("최근 변경 · 새 제목")).toBeTruthy()
  })
})
