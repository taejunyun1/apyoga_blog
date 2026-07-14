import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import type { InstagramOutput } from "@/domain/studio"
import ResultEditor from "@/features/studio/ResultEditor.vue"
import RewriteActionSheet from "@/features/studio/RewriteActionSheet.vue"
import RewriteResultPreview from "@/features/studio/RewriteResultPreview.vue"
import { naverOutput } from "../fixtures"

const instagramOutput: InstagramOutput = {
  hookOptions: ["호흡으로 시작합니다.", "오늘의 수련 기록입니다."],
  captionLong: "차분히 호흡을 살폈습니다.",
  captionShort: "오늘의 호흡 기록",
  hashtags: ["#요가", "#호흡"],
  coverImageId: "",
  imageOrder: [],
  generationSource: "openai",
  qualityChecks: {}
}

describe("result editor rewrite preview", () => {
  it.each(["naver", "instagram"] as const)("places the polite %s preview immediately after the rewrite actions", async (channel) => {
    const wrapper = mount(ResultEditor, {
      props: {
        naver: { status: "success", data: naverOutput, error: null },
        instagram: { status: "success", data: instagramOutput, error: null },
        review: { medicalClaims: [], repetitions: [], privacyWarnings: [], passed: true },
        copyFallback: null,
        images: [],
        pendingRewriteKey: null,
        rewritePreviews: {
          naver: { kind: "single", section: "intro", label: "도입부", text: "새 도입부" },
          instagram: { kind: "single", section: "hook", label: "첫 문장", text: "새 첫 문장" }
        }
      }
    })
    if (channel === "instagram") await wrapper.findAll('[role="tab"]')[1].trigger("click")

    const actions = wrapper.findComponent(RewriteActionSheet)
    const preview = wrapper.findComponent(RewriteResultPreview)
    expect(preview.exists()).toBe(true)
    expect(preview.element.previousElementSibling).toBe(actions.element)
    expect(preview.attributes("aria-live")).toBe("polite")
  })

  it("renders a title and body pair as separate recent-change values", () => {
    const wrapper = mount(ResultEditor, {
      props: {
        naver: { status: "success", data: naverOutput, error: null },
        instagram: { status: "success", data: instagramOutput, error: null },
        review: { medicalClaims: [], repetitions: [], privacyWarnings: [], passed: true },
        copyFallback: null,
        images: [],
        pendingRewriteKey: null,
        rewritePreviews: {
          naver: {
            kind: "title-body",
            section: "titleAndBody",
            label: "새 제목과 본문",
            title: "고요한 공간에서 다시 만난 호흡",
            body: "공간의 결과 호흡의 리듬을 감성적인 여운으로 풀어낸 새 본문입니다.",
          },
        } as never,
      }
    })

    expect(wrapper.text()).toContain("최근 변경 · 새 제목과 본문")
    expect(wrapper.find(".rewrite-preview__title").text()).toBe("고요한 공간에서 다시 만난 호흡")
    expect(wrapper.find(".rewrite-preview__body").text()).toContain("공간의 결과 호흡의 리듬")
  })
})
