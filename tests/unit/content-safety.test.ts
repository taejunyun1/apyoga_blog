import { describe, expect, it } from "vitest"
import { countMedicalClaimOccurrences } from "@/domain/content-safety"

describe("content safety", () => {
  it.each([
    ["safe copy", "안전한 수련 기록입니다.", 0],
    ["one completion claim", "통증이 완치됩니다. 호흡을 살핀 기록입니다.", 1],
    ["repeated treatment claims", "통증을 치료합니다. 통증을 치료합니다.", 2],
    ["repeated completion claims", "통증이 완치됩니다. 통증이 완치됩니다.", 2],
    ["repeated correction claims", "자세가 교정됩니다. 자세가 교정됩니다.", 2],
    ["repeated recovery claims", "통증이 나아집니다. 통증이 나아집니다.", 2],
    ["two completion claims in one sentence", "통증이 완치됩니다 그리고 어깨 불편도 완치됩니다.", 2]
  ])("counts %s", (_label, text, expected) => {
    expect(countMedicalClaimOccurrences(text)).toBe(expected)
  })
})
