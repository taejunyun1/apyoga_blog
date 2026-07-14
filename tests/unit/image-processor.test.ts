import { describe, expect, it } from "vitest"
import { containSize, isHeicFile, validateImageSelection } from "@/adapters/image-processor"

function files(count: number): File[] {
  return Array.from({ length: count }, (_, index) => new File(["image"], `photo-${index}.jpg`, { type: "image/jpeg" }))
}

describe("image preparation", () => {
  it("rejects the eleventh image before decoding", () => {
    expect(() => validateImageSelection(files(11), 0)).toThrow("사진은 최대 10장")
  })

  it("counts existing and newly selected images together", () => {
    expect(() => validateImageSelection(files(4), 7)).toThrow("사진은 최대 10장")
  })

  it("contains a landscape image within a 1280px edge", () => {
    expect(containSize(4032, 3024, 1280)).toEqual({ width: 1280, height: 960 })
  })

  it("does not upscale a smaller image", () => {
    expect(containSize(800, 600, 1280)).toEqual({ width: 800, height: 600 })
  })

  it("recognizes HEIC by MIME or extension", () => {
    expect(isHeicFile(new File(["heic"], "IMG_0001.HEIC", { type: "" }))).toBe(true)
    expect(isHeicFile(new File(["heif"], "photo.bin", { type: "image/heif" }))).toBe(true)
  })
})
