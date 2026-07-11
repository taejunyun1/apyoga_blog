export function studioImages(count = 3) {
  return Array.from({ length: count }, (_, index) => ({
    id: `image-${index + 1}`,
    name: `photo-${index + 1}.jpg`,
    editedBlobId: `blob-${index + 1}`,
    thumbnailUrl: `blob:photo-${index + 1}`,
    width: 1200,
    height: 900,
    hash: `hash-${index + 1}`,
    sortOrder: index,
    isCover: index === 0,
    status: "ready" as const,
    error: null,
    faceCount: index === 0 ? 2 : 0,
    masks: [],
    maskConfirmedAt: null,
    createdAt: "2026-07-11T00:00:00.000Z",
    expiresAt: "2026-07-16T00:00:00.000Z"
  }))
}

export const analyzeInput = {
  memo: "어깨와 흉곽을 천천히 열어간 차분한 저녁 수련",
  mustInclude: "호흡",
  avoid: "치료",
  writingMode: "body-sense" as const,
  naverTone: "plain" as const,
  instagramTone: "emotional" as const,
  images: studioImages(2).map(({ id, isCover, sortOrder }) => ({ id, isCover, sortOrder }))
}
