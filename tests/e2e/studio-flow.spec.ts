import { expect, test, type Page } from "@playwright/test"
import path from "node:path"

const fixturePhoto = path.resolve("public/icons/app-icon-512.png")
const rewrittenIntro = "호흡과 감각을 담아 새롭게 바꾼 문구"
const rewrittenBody = "호흡과 사진 속 수련 장면을 구체적으로 살핀 새 본문입니다. ".repeat(18)
const persistedBody = rewrittenBody.trim()
const rewrittenTitle = "고요한 공간에서 이어진 저녁의 호흡"
const rewrittenTitleBody = "수련이 끝난 뒤에도 호흡의 리듬은 천천히 마음에 남습니다. 오늘은 무리하게 더 나아가기보다, 지금의 몸을 있는 그대로 받아들이며 작은 여백을 만들었습니다. 들이쉬는 숨마다 어깨와 가슴 주변의 긴장이 조금씩 누그러지고, 내쉬는 숨마다 하루 동안 쌓인 생각도 조용히 자리를 찾습니다. 각자의 속도는 달라도 같은 시간 안에서 서로의 호흡을 존중하며 머무는 순간이 참 든든했습니다. 매트 위에서 보낸 이 시간이 바쁜 일상으로 돌아가는 길에도 다정한 중심이 되어 주기를 바랍니다. 다음 수련에서도 나에게 필요한 만큼 쉬고, 필요한 만큼 움직이며, 몸과 마음의 이야기를 차분히 들어보려 합니다. ".repeat(4).trim()

async function mockImageAnalysis(page: Page) {
  await page.route("**/api/content/analyze-images", async (route) => {
    const request = route.request().postDataJSON() as { memo: string; images: Array<{ id: string; sortOrder: number }> }
    const ids = request.images.sort((a, b) => a.sortOrder - b.sortOrder).map((image) => image.id)
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        source: "openai",
        data: {
          classSummary: request.memo,
          overallMood: "갈색 원형 로고가 보이는 차분한 장면",
          bodyFocus: ["원형", "로고"],
          visualKeywords: ["갈색", "원형", "로고"],
          imageDescriptions: ids.map((imageId) => ({ imageId, description: "갈색 배경 위에 밝은 원형 로고와 작은 글자가 보이는 이미지" })),
          recommendedCoverImageId: ids[0],
          recommendedImageOrder: ids,
          uncertainClaims: [],
          seasonalContext: "",
          userMemoSummary: request.memo
        }
      })
    })
  })
}

async function seedHistory(page: Page) {
  await page.goto("/")
  await page.getByRole("button", { name: "새 글 만들기" }).click()
  await expect(page).toHaveURL(/\/studio\//)
  await page.goto("/")
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("ap-yoga-content-studio")
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction(["drafts", "history"], "readwrite")
    const drafts = transaction.objectStore("drafts")
    const history = transaction.objectStore("history")
    const unfinished = {
      id: "active-draft",
      title: "작성 중인 글",
      updatedAt: "2026-07-14T00:00:00.000Z",
      finalizedAt: null,
      images: []
    }
    const first = {
      id: "history-one",
      title: "저녁 수련 기록",
      updatedAt: "2026-07-14T01:00:00.000Z",
      finalizedAt: "2026-07-14T01:00:00.000Z",
      images: []
    }
    const second = {
      id: "history-two",
      title: "아침 호흡 기록",
      updatedAt: "2026-07-14T02:00:00.000Z",
      finalizedAt: "2026-07-14T02:00:00.000Z",
      images: []
    }
    drafts.put({ id: unfinished.id, updatedAt: unfinished.updatedAt, finalizedAt: null, value: unfinished })
    for (const value of [first, second]) {
      drafts.put({ id: value.id, updatedAt: value.updatedAt, finalizedAt: value.finalizedAt, value })
      history.put({ id: value.id, finalizedAt: value.finalizedAt, value })
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
  })
  await page.reload()
}

test("deletes individual and all completed history without removing active drafts", async ({ page }, testInfo) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ status: 204 }))
  await seedHistory(page)

  const individualDelete = page.getByRole("button", { name: "저녁 수련 기록 삭제" })
  await expect(individualDelete).toBeVisible()
  await expect(individualDelete).toHaveCSS("cursor", "pointer")
  await individualDelete.click()
  const individualDialog = page.getByRole("alertdialog", { name: "기록 삭제" })
  await expect(individualDialog).toContainText("“저녁 수련 기록” 기록을 삭제할까요?")
  await expect(individualDialog.getByRole("button", { name: "취소" })).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath("history-delete-dialog.png"), fullPage: true })
  await individualDialog.getByRole("button", { name: "삭제" }).click()

  const deleteToast = page.getByRole("status")
  await expect(deleteToast).toHaveText("기록을 삭제했어요")
  await deleteToast.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished))
  })
  const toastBox = await deleteToast.boundingBox()
  const privacyRailBox = await page.locator(".privacy-rail").boundingBox()
  expect(toastBox).not.toBeNull()
  expect(privacyRailBox).not.toBeNull()
  expect(toastBox!.y + toastBox!.height).toBeLessThanOrEqual(privacyRailBox!.y - 8)
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText("저녁 수련 기록")).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath("history-delete-toast.png"), fullPage: true })

  await page.reload()
  await expect(page.getByText("저녁 수련 기록")).toHaveCount(0)
  await expect(page.getByText("아침 호흡 기록")).toBeVisible()
  await expect(page.getByRole("link", { name: "작성 중인 글 이어서 작성" })).toBeVisible()

  await page.getByRole("button", { name: "전체 삭제" }).click()
  const clearDialog = page.getByRole("alertdialog", { name: "모든 기록 삭제" })
  await expect(clearDialog).toContainText("저장된 기록 1개를 모두 삭제할까요?")
  await clearDialog.getByRole("button", { name: "삭제" }).click()

  await expect(page.getByRole("status")).toHaveText("모든 기록을 삭제했어요")
  await expect(page.getByText("완료한 콘텐츠가 이곳에 표시됩니다.")).toBeVisible()
  await expect(page.getByRole("link", { name: "작성 중인 글 이어서 작성" })).toBeVisible()
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(horizontalOverflow).toBe(false)

  await page.screenshot({ path: testInfo.outputPath("history-deletion.png"), fullPage: true })
})

test("creates and restores a two-channel yoga post", async ({ page }, testInfo) => {
  await mockImageAnalysis(page)
  await page.route("**/api/content/generate", (route) => route.fulfill({ status: 503, body: "local fallback" }))
  await page.route("**/api/content/rewrite", async (route) => {
    const request = route.request().postDataJSON() as { kind?: string; section?: string }
    if (request.kind === "naver-title-body") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ source: "openai", data: { title: rewrittenTitle, body: rewrittenTitleBody } })
      })
      return
    }

    const text = request.section === "body" ? rewrittenBody : rewrittenIntro
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ source: "openai", data: { section: request.section, text } })
    })
  })
  await page.goto("/")

  await page.getByRole("button", { name: "새 글 만들기" }).click()
  const disabledNextButton = page.getByRole("button", { name: "사진 순서 정하기" })
  await expect(disabledNextButton).toBeDisabled()
  await expect(disabledNextButton).toHaveCSS("cursor", "not-allowed")
  await page.getByLabel("수련 사진 선택").setInputFiles([fixturePhoto, fixturePhoto])
  await expect(page.getByText("처리 완료")).toHaveCount(2)

  await page.getByRole("button", { name: "사진 순서 정하기" }).click()
  await expect(page.getByText("가림")).toHaveCount(0)

  await expect(page.getByRole("heading", { name: "사진 순서와 대표 사진" })).toBeVisible()
  await page.getByRole("button", { name: "메모 작성하기" }).click()
  await page.getByLabel("오늘의 수련 메모").fill("어깨와 흉곽을 천천히 열어간 차분한 저녁 수련")
  await page.getByLabel("꼭 포함할 내용").fill("호흡")
  await page.getByLabel("피할 내용").fill("치료, 완치")
  await page.getByRole("button", { name: "AI 이해 내용 만들기" }).click()

  await expect(page.getByRole("heading", { name: "AI가 이해한 오늘의 수련" })).toBeVisible()
  await expect(page.getByText(/갈색 배경 위에 밝은 원형 로고/).first()).toBeVisible()
  await page.getByRole("button", { name: "이해한 내용이 맞아요" }).click()
  await page.getByRole("button", { name: "두 채널 글 생성" }).click()

  await expect(page.getByRole("tab", { name: "네이버 블로그" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "인스타그램" })).toBeVisible()
  await expect(page.getByText("네이버 글이 준비됐어요")).toBeVisible()
  await expect(page.getByText("두 채널 글을 생성했어요")).toBeVisible()

  const naverTitles = page.locator('input[name="naver-title"]')
  await expect(naverTitles).toHaveCount(3)
  await naverTitles.nth(1).check()
  await expect(page.getByText("제목 옵션을 변경했어요")).toBeVisible()
  await expect(naverTitles.nth(0)).toBeChecked()

  const rewriteButton = page.getByRole("button", { name: "도입부 감성 줄이기" })
  await expect(rewriteButton).toHaveCSS("cursor", "pointer")
  await rewriteButton.click()
  await expect(page.getByText("도입부의 감성을 줄였어요")).toBeVisible()
  await expect(page.getByText("최근 변경 · 도입부")).toBeVisible()
  await expect(page.locator(".rewrite-preview p")).toHaveText(rewrittenIntro)
  await expect(page.getByRole("radio", { name: rewrittenIntro })).toBeChecked()

  await expect(page.getByRole("heading", { name: "사진과 글 배치" })).toBeVisible()
  const naverImageCards = page.locator(".result-image-card")
  await expect(naverImageCards).toHaveCount(2)
  await expect(naverImageCards.locator("img")).toHaveCount(2)
  for (const card of await naverImageCards.all()) {
    await expect(card.locator("img")).toHaveCount(1)
    await expect(card.locator(".result-image-card__position")).toHaveText(/문단 \d+ 뒤/)
    await expect(card.locator(".result-image-card__caption")).toHaveCount(0)
  }

  await page.getByRole("button", { name: "사진 분위기 더하기" }).click()
  await expect(page.getByText("사진의 분위기를 보강했어요")).toBeVisible()
  await expect(page.getByText("최근 변경 · 네이버 본문")).toBeVisible()
  await expect(page.getByLabel("본문 편집")).toHaveValue(persistedBody)
  const bodyPreview = page.locator(".rewrite-preview p")
  await expect(bodyPreview).toHaveText(persistedBody)
  await expect(bodyPreview).toHaveCSS("-webkit-line-clamp", "4")
  expect(await bodyPreview.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)

  await page.getByRole("button", { name: "최근 글과 다르게" }).click()
  await expect(page.getByText("제목과 본문을 새롭게 만들었어요")).toBeVisible()
  await expect(page.getByText("최근 변경 · 새 제목과 본문")).toBeVisible()
  await expect(page.getByRole("radio", { name: rewrittenTitle })).toBeChecked()
  await expect(page.getByLabel("본문 편집")).toHaveValue(rewrittenTitleBody)
  await expect(page.locator(".rewrite-preview__title")).toHaveText(rewrittenTitle)
  await expect(page.locator(".rewrite-preview__body")).toContainText("수련이 끝난 뒤에도 호흡의 리듬은")

  await page.getByRole("tab", { name: "인스타그램" }).click()
  await expect(page.getByText("인스타그램 글이 준비됐어요")).toBeVisible()
  await expect(page.getByText("인스타그램 결과를 열었어요")).toBeVisible()
  await expect(page.getByRole("heading", { name: "사진 게시 순서" })).toBeVisible()
  const instagramImageCards = page.locator(".result-image-card")
  await expect(instagramImageCards).toHaveCount(2)
  const firstInstagramCard = instagramImageCards.first()
  await expect(firstInstagramCard.locator("img")).toHaveCount(1)
  await expect(firstInstagramCard.locator(".result-image-card__position")).toHaveText("1번째")
  const coverBadge = page.locator(".result-image-card__cover")
  await expect(coverBadge).toHaveText("대표 사진")
  await expect(coverBadge.locator("..").locator(".result-image-card__position")).toHaveText(/\d+번째/)

  if (testInfo.project.name === "mobile-chromium") {
    await expect(page.getByLabel("기본형 캡션")).toHaveCSS("font-size", "16px")
    await page.setViewportSize({ width: 844, height: 390 })
    await expect(page.getByLabel("기본형 캡션")).toHaveCSS("font-size", "16px")
    await page.setViewportSize({ width: 390, height: 844 })

    const mobileLayout = await page.locator(".result-image-map__list").evaluate((list) => {
      const firstCard = list.querySelector<HTMLElement>(".result-image-card")
      return {
        display: getComputedStyle(list).display,
        overflowX: getComputedStyle(list).overflowX,
        clientWidth: list.clientWidth,
        scrollWidth: list.scrollWidth,
        firstCardWidth: firstCard?.getBoundingClientRect().width ?? 0
      }
    })
    expect(mobileLayout.display).toBe("flex")
    expect(mobileLayout.overflowX).toBe("auto")
    expect(mobileLayout.scrollWidth).toBeGreaterThan(mobileLayout.clientWidth)
    expect(mobileLayout.firstCardWidth).toBeLessThan(mobileLayout.clientWidth)
  } else {
    await expect(page.locator(".result-image-map__list")).toHaveCSS("display", "grid")
  }

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(horizontalOverflow).toBe(false)

  await page.screenshot({ path: testInfo.outputPath("completed-flow.png"), fullPage: true })
  await page.getByRole("button", { name: "작성 이력에 저장하고 메인으로" }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole("status")).toHaveText("작성 이력에 저장했어요")
  await expect(page.getByRole("heading", { name: "최근 작성 기록" })).toBeVisible()
  await expect(page.getByText(rewrittenTitle)).toBeVisible()

  await page.reload()
  await expect(page.getByText("작성 이력에 저장했어요")).toHaveCount(0)
  await expect(page.getByText(rewrittenTitle)).toBeVisible()
})
