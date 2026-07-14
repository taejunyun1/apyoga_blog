import type { ContentBrief, InstagramOutput, NaverOutput, ReviewOutput, Tone, WritingMode } from "./studio"

export interface AnalyzeImagesInput {
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
  analyzeImages(input: AnalyzeImagesInput): Promise<ContentBrief>
  generateNaver(input: ChannelInput): Promise<NaverOutput>
  generateInstagram(input: ChannelInput): Promise<InstagramOutput>
  rewriteSection(input: RewriteInput): Promise<RewriteOutput>
  rewriteNaverTitleAndBody(input: RewriteNaverTitleAndBodyInput): Promise<RewriteNaverTitleAndBodyOutput>
  review(input: { text: string }): Promise<ReviewOutput>
}
