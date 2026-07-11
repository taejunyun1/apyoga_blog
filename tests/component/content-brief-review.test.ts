import { fireEvent, render, screen } from "@testing-library/vue"
import { describe, expect, it } from "vitest"
import ContentBriefReview from "@/features/studio/ContentBriefReview.vue"

const brief = {
  classSummary: "어깨와 흉곽을 천천히 열어간 저녁 수련",
  overallMood: "차분한 수련의 분위기",
  bodyFocus: ["어깨", "흉곽"],
  visualKeywords: ["호흡", "정돈"],
  imageDescriptions: [],
  recommendedCoverImageId: "image-1",
  recommendedImageOrder: ["image-1"],
  uncertainClaims: [],
  seasonalContext: "여름 저녁",
  userMemoSummary: "어깨와 흉곽 수련"
}

describe("ContentBriefReview", () => {
  it("requires explicit confirmation before dual-channel generation", async () => {
    const { emitted } = render(ContentBriefReview, { props: { brief, confirmed: false, busy: false } })

    expect(screen.getByRole("button", { name: "두 채널 글 생성" }).hasAttribute("disabled")).toBe(true)
    await fireEvent.click(screen.getByRole("button", { name: "이해한 내용이 맞아요" }))

    expect(emitted().confirm).toHaveLength(1)
  })

  it("emits edited body-focus chips without mutating the prop", async () => {
    const { emitted } = render(ContentBriefReview, { props: { brief, confirmed: false, busy: false } })
    await fireEvent.click(screen.getByRole("button", { name: "흉곽 삭제" }))

    const updated = (emitted()["update:brief"]?.[0] as unknown[])?.[0] as typeof brief
    expect(updated.bodyFocus).toEqual(["어깨"])
    expect(brief.bodyFocus).toEqual(["어깨", "흉곽"])
  })
})
