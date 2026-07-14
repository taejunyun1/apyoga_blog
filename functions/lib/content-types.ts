export type ContentChannel = "naver" | "instagram"

export type RewriteSection = "title" | "intro" | "body" | "hook" | "caption" | "short" | "hashtags"

export interface AnalyzeImagesContentInput {
  memo: string
  mustInclude: string
  avoid: string
  writingMode: GenerateContentInput["writingMode"]
  naverTone: GenerateContentInput["tone"]
  instagramTone: GenerateContentInput["tone"]
  images: Array<{
    id: string
    isCover: boolean
    sortOrder: number
    dataUrl: string
  }>
}

export interface ImageAnalysisResult {
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

export interface GenerateContentInput {
  memo: string
  mustInclude: string
  avoid: string
  writingMode: "auto" | "record" | "essay" | "philosophy" | "body-sense" | "space" | "daily"
  tone: "plain" | "emotional" | "deep"
  brief: {
    classSummary: string
    overallMood: string
    bodyFocus: string[]
    imageDescriptions: Array<{ imageId: string; description: string }>
    recommendedCoverImageId: string
    recommendedImageOrder: string[]
  }
}

export interface RewriteContentInput {
  channel: ContentChannel
  section: RewriteSection
  instruction: string
  currentText: string
  memo: string
  avoid: string
  tone: GenerateContentInput["tone"]
}

export interface RewrittenContent {
  section: RewriteSection
  text: string
}

export interface RewriteNaverTitleAndBodyContentInput {
  kind: "naver-title-body"
  instruction: string
  currentTitle: string
  currentBody: string
  memo: string
  photoContext: string
  avoid: string
  tone: GenerateContentInput["tone"]
}

export interface RewrittenNaverTitleAndBodyContent {
  title: string
  body: string
}

export interface GeneratedNaver {
  titles: string[]
  introOptions: string[]
  body: string
  imagePlacements: Array<{ imageId: string; afterParagraph: number; caption: string }>
  hashtags: string[]
  classInfo: string
}

export interface GeneratedInstagram {
  hookOptions: string[]
  captionLong: string
  captionShort: string
  hashtags: string[]
  coverImageId: string
  imageOrder: string[]
}

export type GeneratedContent = GeneratedNaver | GeneratedInstagram
