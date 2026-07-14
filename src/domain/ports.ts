import type { ContentBrief, DraftUsage, InstagramOutput, NaverOutput, ReviewOutput, Tone, WritingMode } from "./studio"

export type UsageRecord = DraftUsage

export interface AIResult<T> {
  data: T
  usage: UsageRecord | null
}

export interface AnalyzeImagesInput {
  draftId?: string
  memo: string
  mustInclude: string
  avoid: string
  writingMode: WritingMode
  naverTone: Tone
  instagramTone: Tone
  images: Array<{ id: string; isCover: boolean; sortOrder: number; dataUrl?: string }>
}

export interface ChannelInput extends AnalyzeImagesInput {
  brief: ContentBrief
}

export interface RewriteInput {
  draftId?: string
  channel: "naver" | "instagram"
  section: string
  currentText: string
  instruction: string
  memo: string
  avoid: string
  tone: Tone
}

export interface RewriteOutput {
  section: string
  text: string
}

export interface RewriteNaverTitleAndBodyInput {
  draftId?: string
  currentTitle: string
  currentBody: string
  instruction: string
  memo: string
  photoContext: string
  avoid: string
  tone: Tone
}

export interface RewriteNaverTitleAndBodyOutput {
  title: string
  body: string
}

export interface AIProvider {
  analyzeImages(input: AnalyzeImagesInput): Promise<AIResult<ContentBrief>>
  generateNaver(input: ChannelInput): Promise<AIResult<NaverOutput>>
  generateInstagram(input: ChannelInput): Promise<AIResult<InstagramOutput>>
  rewriteSection(input: RewriteInput): Promise<AIResult<RewriteOutput>>
  rewriteNaverTitleAndBody(input: RewriteNaverTitleAndBodyInput): Promise<AIResult<RewriteNaverTitleAndBodyOutput>>
  review(input: { text: string }): Promise<ReviewOutput>
}
