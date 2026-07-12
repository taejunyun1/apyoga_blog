import type { NaverOutput, StudioImage } from "@/domain/studio"

export const naverOutput: NaverOutput = {
  titles: ["호흡과 함께한 저녁 수련", "어깨를 여는 시간", "오늘의 요가 기록"],
  introOptions: ["차분한 저녁 수련을 시작했습니다.", "호흡으로 돌아옵니다.", "몸의 감각을 살펴봅니다."],
  body: "오늘은 어깨와 흉곽에 천천히 주의를 기울였습니다.",
  imagePlacements: [],
  hashtags: ["#에이피요가", "#요가수련"],
  classInfo: "예약 정보 확인",
  generationSource: "openai",
  qualityChecks: {}
}

export function studioImages(count = 3): StudioImage[] {
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
    status: "ready",
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
