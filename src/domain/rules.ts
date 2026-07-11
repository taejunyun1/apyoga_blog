import type { ReviewOutput, StudioImage } from "./studio"

export function reorderImages(images: StudioImage[], _from: number, _to: number): StudioImage[] {
  if (_from < 0 || _from >= images.length || _to < 0 || _to >= images.length || _from === _to) {
    return images.map((image, sortOrder) => ({ ...image, sortOrder }))
  }

  const reordered = [...images]
  const [moved] = reordered.splice(_from, 1)
  reordered.splice(_to, 0, moved)
  return reordered.map((image, sortOrder) => ({ ...image, sortOrder }))
}

export function setCoverImage(images: StudioImage[], _imageId: string): StudioImage[] {
  if (!images.some((image) => image.id === _imageId)) return images
  return images.map((image) => ({ ...image, isCover: image.id === _imageId }))
}

export function expiresAtFor(createdAt: string): string {
  const expiresAt = new Date(createdAt)
  expiresAt.setUTCDate(expiresAt.getUTCDate() + 5)
  return expiresAt.toISOString()
}

export function validateImageCount(_count: number): void {
  if (_count > 10) throw new Error("사진은 최대 10장까지 선택할 수 있어요.")
  if (_count < 1) throw new Error("사진을 한 장 이상 선택해 주세요.")
}

export function reviewText(_text: string): ReviewOutput {
  const medicalPatterns = ["치료합니다", "완치", "교정됩니다", "낫습니다"]
  const medicalClaims = medicalPatterns.filter((pattern) => _text.includes(pattern))
  const phrases = _text
    .split(/[.!?。\n]+/)
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length >= 4)
  const counts = new Map<string, number>()

  for (const phrase of phrases) counts.set(phrase, (counts.get(phrase) ?? 0) + 1)

  const repetitions = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([phrase]) => phrase)

  return {
    medicalClaims,
    repetitions,
    privacyWarnings: [],
    passed: medicalClaims.length === 0 && repetitions.length === 0
  }
}
