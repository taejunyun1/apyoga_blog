export type ContentChannel = "naver" | "instagram"

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
