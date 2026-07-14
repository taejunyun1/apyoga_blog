import { fireEvent, render, screen } from "@testing-library/vue"
import { describe, expect, it } from "vitest"
import PhotoOrganizer from "@/features/studio/PhotoOrganizer.vue"
import { studioImages } from "../fixtures"

describe("PhotoOrganizer", () => {
  it("offers keyboard-friendly ordering and one cover action", async () => {
    const images = studioImages(2)
    const { emitted } = render(PhotoOrganizer, { props: { images } })

    await fireEvent.click(screen.getByRole("button", { name: `${images[1].name} 앞으로 이동` }))
    await fireEvent.click(screen.getByRole("button", { name: `${images[1].name} 대표 사진으로 선택` }))

    expect(emitted().reorder?.[0]).toEqual([1, 0])
    expect(emitted()["set-cover"]?.[0]).toEqual([images[1].id])
  })

  it("shows image dimensions and expiry for every photo", () => {
    const [image] = studioImages(1)
    render(PhotoOrganizer, { props: { images: [image] } })

    expect(screen.getByText("1200 × 900px")).toBeTruthy()
    expect(screen.getByText(/7월 16일/)).toBeTruthy()
  })
})
