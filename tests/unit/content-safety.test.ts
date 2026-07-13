import { describe, expect, it } from "vitest"
import { countMedicalClaimOccurrences } from "@/domain/content-safety"

describe("content safety", () => {
  it.each([
    ["안전한 수련 기록입니다.", 0],
    ["통증이 완치됩니다. 호흡을 살핀 기록입니다.", 1],
    ["통증이 완치됩니다. 어깨 불편도 완치됩니다.", 2],
    ["통증이 완치됩니다 그리고 어깨 불편도 완치됩니다.", 2]
  ])("counts direct medical claim occurrences in %s", (text, expected) => {
    expect(countMedicalClaimOccurrences(text)).toBe(expected)
  })
})
