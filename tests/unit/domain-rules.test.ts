import { describe, expect, it } from "vitest"
import { expiresAtFor, reorderImages, reviewText, setCoverImage, validateImageCount } from "@/domain/rules"
import { studioImages } from "../fixtures"

describe("studio domain rules", () => {
  it("reorders images and normalizes sort order", () => {
    const result = reorderImages(studioImages(), 2, 0)

    expect(result.map((image) => image.id)).toEqual(["image-3", "image-1", "image-2"])
    expect(result.map((image) => image.sortOrder)).toEqual([0, 1, 2])
  })

  it("keeps exactly one cover image", () => {
    const result = setCoverImage(studioImages(), "image-2")

    expect(result.filter((image) => image.isCover)).toHaveLength(1)
    expect(result.find((image) => image.isCover)?.id).toBe("image-2")
  })

  it("expires edited images exactly five days after creation", () => {
    expect(expiresAtFor("2026-07-11T00:00:00.000Z")).toBe("2026-07-16T00:00:00.000Z")
  })

  it("rejects an eleventh image", () => {
    expect(() => validateImageCount(11)).toThrow("사진은 최대 10장")
  })

  it("flags medical certainty and repeated expressions", () => {
    const result = reviewText("통증을 치료합니다. 호흡을 느껴요. 호흡을 느껴요.")

    expect(result.medicalClaims).toContain("치료합니다")
    expect(result.repetitions).toContain("호흡을 느껴요")
  })
})
