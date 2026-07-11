export type WorkflowStep = "photos" | "mask" | "organize" | "memo" | "brief" | "generating" | "results"
export type WritingMode = "auto" | "record" | "essay" | "philosophy" | "body-sense" | "space" | "daily"
export type Tone = "plain" | "emotional" | "deep"
export type Channel = "naver" | "instagram"
export type ChannelStatus = "idle" | "loading" | "success" | "error"
export type MaskStyle = "blur" | "white" | "sticker"

export interface FaceMask {
  id: string
  style: MaskStyle
  x: number
  y: number
  width: number
  height: number
  rotation: number
  source: "detected" | "manual"
}

export interface StudioImage {
  id: string
  name: string
  editedBlobId: string
  thumbnailUrl: string
  width: number
  height: number
  hash: string
  sortOrder: number
  isCover: boolean
  status: "processing" | "ready" | "error"
  error: string | null
  faceCount: number
  masks: FaceMask[]
  maskConfirmedAt: string | null
  createdAt: string
  expiresAt: string
}

export interface ContentBrief {
  classSummary: string
  overallMood: string
  bodyFocus: string[]
  visualKeywords: string[]
  imageDescriptions: Array<{ imageId: string; description: string }>
  recommendedCoverImageId: string
  recommendedImageOrder: string[]
  uncertainClaims: string[]
  seasonalContext: string
  userMemoSummary: string
}

export interface NaverOutput {
  titles: string[]
  introOptions: string[]
  body: string
  imagePlacements: Array<{ imageId: string; afterParagraph: number; caption: string }>
  hashtags: string[]
  classInfo: string
  qualityChecks: Record<string, boolean>
}

export interface InstagramOutput {
  hookOptions: string[]
  captionLong: string
  captionShort: string
  hashtags: string[]
  coverImageId: string
  imageOrder: string[]
  qualityChecks: Record<string, boolean>
}

export interface ReviewOutput {
  medicalClaims: string[]
  repetitions: string[]
  privacyWarnings: string[]
  passed: boolean
}

export interface ChannelResult<T> {
  status: ChannelStatus
  data: T | null
  error: string | null
}

export interface StudioDraft {
  id: string
  step: WorkflowStep
  title: string
  sourceMemo: string
  mustInclude: string
  avoid: string
  writingMode: WritingMode
  naverTone: Tone
  instagramTone: Tone
  images: StudioImage[]
  brief: ContentBrief | null
  briefConfirmed: boolean
  naver: ChannelResult<NaverOutput>
  instagram: ChannelResult<InstagramOutput>
  review: ReviewOutput | null
  createdAt: string
  updatedAt: string
  finalizedAt: string | null
}

export function createDraft(now = new Date().toISOString()): StudioDraft {
  return {
    id: crypto.randomUUID(),
    step: "photos",
    title: "새 콘텐츠",
    sourceMemo: "",
    mustInclude: "",
    avoid: "",
    writingMode: "auto",
    naverTone: "plain",
    instagramTone: "emotional",
    images: [],
    brief: null,
    briefConfirmed: false,
    naver: { status: "idle", data: null, error: null },
    instagram: { status: "idle", data: null, error: null },
    review: null,
    createdAt: now,
    updatedAt: now,
    finalizedAt: null
  }
}
