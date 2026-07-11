import imageCompression from "browser-image-compression"
import { expiresAtFor } from "@/domain/rules"
import type { FaceMask } from "@/domain/studio"

const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"])

export interface PreparedImage {
  blob: Blob
  thumbnailUrl: string
  width: number
  height: number
  hash: string
  createdAt: string
  expiresAt: string
}

export interface PixelMaskGeometry {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

export function validateImageSelection(files: File[], existingCount: number): void {
  if (files.length + existingCount > 10) throw new Error("사진은 최대 10장까지 선택할 수 있어요.")
  const unsupported = files.find((file) => !SUPPORTED_TYPES.has(file.type) && !isHeicFile(file))
  if (unsupported) throw new Error(`${unsupported.name}은 지원하지 않는 이미지 형식이에요.`)
}

export function containSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const ratio = maxEdge / longest
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) }
}

export function isHeicFile(file: File): boolean {
  return file.type === "image/heic" || file.type === "image/heif" || /\.(heic|heif)$/i.test(file.name)
}

export function maskGeometryToPixels(mask: FaceMask, width: number, height: number): PixelMaskGeometry {
  return {
    x: Math.round(mask.x * width),
    y: Math.round(mask.y * height),
    width: Math.round(mask.width * width),
    height: Math.round(mask.height * height),
    rotation: mask.rotation
  }
}

async function toBrowserImage(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob)
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.decoding = "async"
    image.src = url
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("편집 이미지를 만들지 못했어요.")), "image/jpeg", 0.84)
  })
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function prepareImage(file: File, now = new Date().toISOString()): Promise<PreparedImage> {
  const converted = isHeicFile(file)
    ? await import("heic2any").then(({ default: convertHeic }) => convertHeic({ blob: file, toType: "image/jpeg", quality: 0.9 }))
    : file
  const source = Array.isArray(converted) ? converted[0] : converted
  const compressed = await imageCompression(new File([source], `${file.name}.jpg`, { type: "image/jpeg" }), {
    maxWidthOrHeight: 1280,
    maxSizeMB: 2,
    useWebWorker: true,
    preserveExif: false,
    fileType: "image/jpeg",
    initialQuality: 0.84
  })
  const image = await toBrowserImage(compressed)
  const size = containSize(image.width, image.height, 1280)
  const canvas = document.createElement("canvas")
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext("2d", { alpha: false })
  if (!context) throw new Error("이 브라우저에서 이미지를 편집할 수 없어요.")
  context.drawImage(image, 0, 0, size.width, size.height)
  if ("close" in image && typeof image.close === "function") image.close()
  const blob = await canvasBlob(canvas)

  return {
    blob,
    thumbnailUrl: URL.createObjectURL(blob),
    width: size.width,
    height: size.height,
    hash: await sha256(blob),
    createdAt: now,
    expiresAt: expiresAtFor(now)
  }
}

export async function applyMasksToBlob(source: Blob, masks: FaceMask[]): Promise<Blob> {
  const image = await toBrowserImage(source)
  const canvas = document.createElement("canvas")
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext("2d", { alpha: false })
  if (!context) throw new Error("가림 편집본을 만들 수 없어요.")
  context.drawImage(image, 0, 0)

  for (const mask of masks) {
    const box = maskGeometryToPixels(mask, canvas.width, canvas.height)
    const centerX = box.x + box.width / 2
    const centerY = box.y + box.height / 2
    context.save()
    context.translate(centerX, centerY)
    context.rotate(box.rotation * Math.PI / 180)
    context.beginPath()
    context.ellipse(0, 0, box.width / 2, box.height / 2, 0, 0, Math.PI * 2)
    context.clip()

    if (mask.style === "blur") {
      context.rotate(-box.rotation * Math.PI / 180)
      context.translate(-centerX, -centerY)
      const mosaic = document.createElement("canvas")
      mosaic.width = Math.max(2, Math.round(box.width / 18))
      mosaic.height = Math.max(2, Math.round(box.height / 18))
      const mosaicContext = mosaic.getContext("2d", { alpha: false })
      if (mosaicContext) {
        mosaicContext.drawImage(image, box.x, box.y, box.width, box.height, 0, 0, mosaic.width, mosaic.height)
        context.imageSmoothingEnabled = false
        context.drawImage(mosaic, 0, 0, mosaic.width, mosaic.height, box.x, box.y, box.width, box.height)
        context.imageSmoothingEnabled = true
      } else {
        context.fillStyle = "#6F6A63"
        context.fillRect(box.x, box.y, box.width, box.height)
      }
    } else if (mask.style === "white") {
      context.fillStyle = "#FFFFFF"
      context.fillRect(-box.width / 2, -box.height / 2, box.width, box.height)
    } else {
      context.fillStyle = "#F0D7B5"
      context.fillRect(-box.width / 2, -box.height / 2, box.width, box.height)
      context.strokeStyle = "#2B2B2B"
      context.lineWidth = Math.max(2, box.width * 0.025)
      context.beginPath()
      context.moveTo(-box.width * 0.22, box.height * 0.05)
      context.quadraticCurveTo(0, -box.height * 0.28, box.width * 0.22, box.height * 0.05)
      context.stroke()
    }
    context.restore()
  }

  if ("close" in image && typeof image.close === "function") image.close()
  return canvasBlob(canvas)
}
