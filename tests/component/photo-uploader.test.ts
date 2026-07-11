import { fireEvent, render, screen } from "@testing-library/vue"
import { describe, expect, it } from "vitest"
import PhotoUploader from "@/features/studio/PhotoUploader.vue"
import { studioImages } from "../fixtures"

describe("PhotoUploader", () => {
  it("emits selected supported files and shows the ten-photo limit", async () => {
    const { emitted } = render(PhotoUploader, { props: { images: [], busy: false } })
    const input = screen.getByLabelText("수련 사진 선택")
    const files = [new File(["image"], "class.jpg", { type: "image/jpeg" })]

    await fireEvent.change(input, { target: { files } })

    expect(emitted()["files-selected"]?.[0]).toEqual([files])
    expect(screen.getByText(/최대 10장/)).toBeTruthy()
  })

  it("keeps successful images visible beside an individual retry", () => {
    const [ready, failed] = studioImages(2)
    failed.status = "error"
    failed.error = "HEIC 변환에 실패했어요."
    render(PhotoUploader, { props: { images: [ready, failed], busy: false } })

    expect(screen.getByText("처리 완료")).toBeTruthy()
    expect(screen.getByRole("button", { name: `${failed.name} 다시 처리` })).toBeTruthy()
  })
})
