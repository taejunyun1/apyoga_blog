import { expect, test, type Page } from "@playwright/test"

const draftId = "partial-success-draft"

async function seedPartialSuccess(page: Page) {
  const now = new Date().toISOString()
  const draft = {
    id: draftId,
    step: "results",
    title: "부분 성공 수련 기록",
    sourceMemo: "호흡과 어깨의 감각을 살핀 수련",
    mustInclude: "호흡",
    avoid: "치료",
    writingMode: "record",
    naverTone: "plain",
    instagramTone: "emotional",
    images: [],
    brief: {
      classSummary: "호흡과 어깨의 감각을 살핀 수련",
      overallMood: "차분한 수련의 분위기",
      bodyFocus: ["어깨"],
      visualKeywords: ["호흡", "차분함"],
      imageDescriptions: [],
      recommendedCoverImageId: "",
      recommendedImageOrder: [],
      uncertainClaims: [],
      seasonalContext: "게시 전에 계절 정보를 확인해 주세요.",
      userMemoSummary: "호흡과 어깨의 감각을 살핀 수련"
    },
    briefConfirmed: true,
    naver: {
      status: "success",
      error: null,
      data: {
        titles: ["어깨와 호흡, 오늘의 수련 기록"],
        introOptions: ["차분한 호흡으로 수련을 시작했습니다."],
        body: "오늘은 어깨와 호흡에 천천히 주의를 기울였습니다.",
        imagePlacements: [],
        hashtags: ["#에이피요가", "#오늘의요가"],
        classInfo: "수업 정보는 게시 전에 확인해 주세요.",
        generationSource: "openai",
        qualityChecks: { safe: true }
      }
    },
    instagram: { status: "error", data: null, error: "인스타그램 생성에 실패했어요." },
    review: { medicalClaims: [], repetitions: [], privacyWarnings: [], passed: true },
    createdAt: now,
    updatedAt: now,
    finalizedAt: null
  }

  await page.goto("/")
  await expect(page.getByText("저장된 임시 글이 없습니다.")).toBeVisible()
  await page.evaluate(async ({ id, value, updatedAt }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("ap-yoga-content-studio")
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction("drafts", "readwrite")
        tx.objectStore("drafts").put({ id, updatedAt, finalizedAt: null, value })
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
    })
  }, { id: draftId, value: draft, updatedAt: now })
}

test("keeps a successful channel and retries only the failed channel", async ({ page }) => {
  await page.route("**/api/content/generate", (route) => route.fulfill({ status: 503, body: "local fallback" }))
  await seedPartialSuccess(page)
  await page.goto(`/studio/${draftId}`)

  await expect(page.getByText("네이버 글이 준비됐어요")).toBeVisible()
  await page.getByRole("tab", { name: "인스타그램" }).click()
  await expect(page.getByText("인스타그램 생성에 실패했어요.")).toBeVisible()
  await page.getByRole("button", { name: "인스타그램만 다시 생성" }).click()
  await expect(page.getByText("인스타그램 글이 준비됐어요")).toBeVisible()

  await page.getByRole("tab", { name: "네이버 블로그" }).click()
  await expect(page.getByText("네이버 글이 준비됐어요")).toBeVisible()
})
