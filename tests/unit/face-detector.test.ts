import { statSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { normalizeAndPadFace } from "@/adapters/mediapipe-face-detector"

describe("face detector geometry", () => {
  it("ships the local model and MediaPipe WASM runtime", () => {
    expect(statSync(resolve("public/models/blaze_face_short_range.tflite")).size).toBe(229746)
    expect(statSync(resolve("public/mediapipe/vision_wasm_internal.wasm")).size).toBeGreaterThan(1_000_000)
    expect(statSync(resolve("public/mediapipe/vision_wasm_internal.js")).size).toBeGreaterThan(100_000)
  })

  it("pads a detected face by 25 percent and clamps it to the image", () => {
    expect(normalizeAndPadFace({ originX: 10, originY: 10, width: 40, height: 40 }, 100, 100, 0.25)).toEqual({
      x: 0.05,
      y: 0.05,
      width: 0.5,
      height: 0.5
    })
  })

  it("never returns geometry outside normalized bounds", () => {
    const face = normalizeAndPadFace({ originX: 0, originY: 0, width: 40, height: 40 }, 100, 100, 0.25)
    expect(face.x).toBe(0)
    expect(face.y).toBe(0)
    expect(face.width).toBe(0.5)
    expect(face.height).toBe(0.5)
  })
})
