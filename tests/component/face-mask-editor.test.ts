import { fireEvent, render, screen } from "@testing-library/vue"
import { describe, expect, it } from "vitest"
import FaceMaskEditor from "@/features/studio/FaceMaskEditor.vue"
import { studioImages } from "../fixtures"

const konvaStubs = {
  "v-stage": { template: "<div data-testid='stage'><slot /></div>" },
  "v-layer": { template: "<div><slot /></div>" },
  "v-image": { template: "<div />" },
  "v-group": { template: "<button type='button' aria-label='가림 영역 선택' @click=\"$emit('click')\"><slot /></button>" },
  "v-ellipse": { template: "<span />" },
  "v-rect": { template: "<span />" },
  "v-transformer": { template: "<span />" }
}

describe("FaceMaskEditor", () => {
  it("adds, deletes, and restores a manual mask", async () => {
    const image = studioImages(1)[0]
    const { emitted } = render(FaceMaskEditor, { props: { image }, global: { stubs: konvaStubs } })

    await fireEvent.click(screen.getByRole("button", { name: "얼굴 추가" }))
    expect(lastMasks(emitted())).toHaveLength(1)
    await fireEvent.click(screen.getByRole("button", { name: "가림 삭제" }))
    expect(lastMasks(emitted())).toHaveLength(0)
    await fireEvent.click(screen.getByRole("button", { name: "실행 취소" }))
    expect(lastMasks(emitted())).toHaveLength(1)
  })

  it("applies one mask style to every face", async () => {
    const image = studioImages(1)[0]
    image.masks = [
      { id: "mask-1", style: "blur", x: 0.1, y: 0.1, width: 0.2, height: 0.2, rotation: 0, source: "detected" },
      { id: "mask-2", style: "blur", x: 0.5, y: 0.1, width: 0.2, height: 0.2, rotation: 0, source: "detected" }
    ]
    const { emitted } = render(FaceMaskEditor, { props: { image }, global: { stubs: konvaStubs } })

    await fireEvent.click(screen.getByRole("button", { name: "흰색 원" }))
    await fireEvent.click(screen.getByRole("button", { name: "모든 얼굴에 적용" }))

    const masks = lastMasks(emitted())
    expect(masks.map((mask) => mask.style)).toEqual(["white", "white"])
  })
})

function lastMasks(events: Record<string, unknown[]>) {
  return (events["update-masks"]?.at(-1) as unknown[])?.[0] as Array<{ style: string }>
}
