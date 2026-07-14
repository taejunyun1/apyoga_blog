import { fireEvent, render, screen } from "@testing-library/vue"
import { describe, expect, it } from "vitest"
import MemoToneForm from "@/features/studio/MemoToneForm.vue"

describe("MemoToneForm", () => {
  it("uses the documented channel defaults and requires a short memo", async () => {
    const { emitted } = render(MemoToneForm, {
      props: { memo: "", mustInclude: "", avoid: "", writingMode: "auto", naverTone: "plain", instagramTone: "emotional" }
    })

    expect((screen.getByLabelText("네이버 톤") as HTMLSelectElement).value).toBe("plain")
    expect((screen.getByLabelText("인스타그램 톤") as HTMLSelectElement).value).toBe("emotional")
    expect(screen.getByRole("button", { name: "AI 이해 내용 만들기" }).hasAttribute("disabled")).toBe(true)
    await fireEvent.update(screen.getByLabelText("오늘의 수련 메모"), "어깨와 흉곽을 천천히 열어간 저녁 수련")
    await fireEvent.click(screen.getByRole("button", { name: "AI 이해 내용 만들기" }))

    expect(emitted().submit).toHaveLength(1)
  })

  it("announces analysis and blocks duplicate submissions while busy", async () => {
    const { emitted } = render(MemoToneForm, {
      props: {
        memo: "호흡과 어깨를 살핀 저녁 수련",
        mustInclude: "",
        avoid: "",
        writingMode: "auto",
        naverTone: "plain",
        instagramTone: "emotional",
        busy: true,
      }
    })

    const button = screen.getByRole("button", { name: "사진과 메모 분석 중…" }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    await fireEvent.submit(button.closest("form") as HTMLFormElement)
    expect(emitted().submit).toBeUndefined()
  })
})
