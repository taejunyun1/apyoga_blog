import { render, screen } from "@testing-library/vue"
import { describe, expect, it } from "vitest"
import ResultImageMap from "@/features/studio/ResultImageMap.vue"
import { studioImages } from "../fixtures"

describe("ResultImageMap", () => {
  it("sorts Naver placements and connects each caption to its thumbnail", () => {
    render(ResultImageMap, {
      props: {
        channel: "naver",
        images: studioImages(3),
        placements: [
          { imageId: "image-2", afterParagraph: 3, caption: "마무리 호흡 장면" },
          { imageId: "image-1", afterParagraph: 1, caption: "수련을 시작하는 장면" }
        ],
        imageOrder: [],
        coverImageId: ""
      }
    })

    expect(screen.getByRole("region", { name: "사진과 글 배치" })).toBeTruthy()
    const cards = screen.getAllByRole("listitem")
    expect(cards[0].textContent).toContain("문단 1 뒤")
    expect(cards[0].textContent).toContain("수련을 시작하는 장면")
    expect(screen.getByRole("img", { name: "수련을 시작하는 장면" }).getAttribute("src")).toBe("blob:photo-1")
    expect(screen.getByRole("img", { name: "수련을 시작하는 장면" }).getAttribute("loading")).toBe("lazy")
  })

  it("shows Instagram order and the cover badge", () => {
    render(ResultImageMap, {
      props: {
        channel: "instagram",
        images: studioImages(3),
        placements: [],
        imageOrder: ["image-3", "image-1", "image-2"],
        coverImageId: "image-3"
      }
    })

    expect(screen.getByRole("region", { name: "사진 게시 순서" })).toBeTruthy()
    expect(screen.getAllByRole("listitem")[0].textContent).toContain("1번째")
    expect(screen.getAllByRole("listitem")[0].textContent).toContain("대표 사진")
    expect(screen.getByRole("img", { name: "1번째 사진 photo-3.jpg" }).getAttribute("src")).toBe("blob:photo-3")
  })

  it("keeps a readable card when an image ID is missing", () => {
    render(ResultImageMap, {
      props: {
        channel: "naver",
        images: studioImages(1),
        placements: [{ imageId: "missing", afterParagraph: 2, caption: "확인할 사진" }],
        imageOrder: [],
        coverImageId: ""
      }
    })

    expect(screen.getByText("사진을 불러올 수 없어요")).toBeTruthy()
    expect(screen.getByText("확인할 사진")).toBeTruthy()
  })
})
