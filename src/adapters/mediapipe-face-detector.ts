import type { FaceDetector } from "@mediapipe/tasks-vision"

export interface PixelBoundingBox {
  originX: number
  originY: number
  width: number
  height: number
}

export function normalizeAndPadFace(
  box: PixelBoundingBox,
  imageWidth: number,
  imageHeight: number,
  paddingRatio = 0.25
): { x: number; y: number; width: number; height: number } {
  const paddedWidth = Math.min(imageWidth, box.width * (1 + paddingRatio))
  const paddedHeight = Math.min(imageHeight, box.height * (1 + paddingRatio))
  const left = Math.min(Math.max(0, box.originX - (paddedWidth - box.width) / 2), imageWidth - paddedWidth)
  const top = Math.min(Math.max(0, box.originY - (paddedHeight - box.height) / 2), imageHeight - paddedHeight)

  return {
    x: left / imageWidth,
    y: top / imageHeight,
    width: paddedWidth / imageWidth,
    height: paddedHeight / imageHeight
  }
}

export interface DetectedFace {
  x: number
  y: number
  width: number
  height: number
  score: number
}

type FaceSource = HTMLImageElement | HTMLCanvasElement | HTMLVideoElement

export class MediaPipeFaceDetector {
  private detectorPromise: Promise<FaceDetector> | null = null
  lastDiagnostic: string | null = null

  private detector(): Promise<FaceDetector> {
    if (!this.detectorPromise) {
      this.detectorPromise = import("@mediapipe/tasks-vision").then(async ({ FaceDetector: Detector, FilesetResolver }) => {
        const vision = await FilesetResolver.forVisionTasks("/mediapipe")
        return Detector.createFromOptions(vision, {
          baseOptions: { modelAssetPath: "/models/blaze_face_short_range.tflite" },
          runningMode: "IMAGE",
          minDetectionConfidence: 0.5
        })
      })
    }
    return this.detectorPromise
  }

  async detect(source: FaceSource): Promise<DetectedFace[]> {
    try {
      const detector = await this.detector()
      const result = detector.detect(source)
      this.lastDiagnostic = null
      return result.detections.flatMap((detection) => {
        const box = detection.boundingBox
        if (!box) return []
        return [{
          ...normalizeAndPadFace(box, source.width, source.height),
          score: detection.categories[0]?.score ?? 0
        }]
      })
    } catch (error) {
      this.lastDiagnostic = error instanceof Error ? error.message : "얼굴 자동 감지를 시작하지 못했어요."
      return []
    }
  }
}
