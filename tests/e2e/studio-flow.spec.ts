import { expect, test, type Page } from "@playwright/test"
import path from "node:path"

const fixturePhoto = path.resolve("public/icons/app-icon-512.png")
const rewrittenIntro = "호흡과 감각을 담아 새롭게 바꾼 문구"
const rewrittenBody = "호흡과 사진 속 수련 장면을 구체적으로 살핀 새 본문입니다. ".repeat(18)
const persistedBody = rewrittenBody.trim()

test("creates and restores a two-channel yoga post", async ({ page }, testInfo) => {
  await page.route("**/api/content/generate", (route) => route.fulfill({ status: 503, body: "local fallback" }))
  await page.route("**/api/content/rewrite", async (route) => {
    const request = route.request().postDataJSON() as { section: string }
    const text = request.section === "body" ? rewrittenBody : rewrittenIntro
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ source: "openai", data: { section: request.section, text } })
    })
  })
  await page.goto("/")

  await page.getByRole("button", { name: "새 글 만들기" }).click()
  const disabledNextButton = page.getByRole("button", { name: "얼굴 가림 확인" })
  await expect(disabledNextButton).toBeDisabled()
  await expect(disabledNextButton).toHaveCSS("cursor", "not-allowed")
  await page.getByLabel("수련 사진 선택").setInputFiles([fixturePhoto, fixturePhoto])
  await expect(page.getByText("처리 완료")).toHaveCount(2)

  await page.getByRole("button", { name: "얼굴 가림 확인" }).click()
  await expect(page.getByText("자동 감지 결과가 없어요. 필요하면 수동으로 얼굴을 추가해 주세요.")).toBeVisible()
  await page.getByRole("button", { name: "얼굴 추가" }).click()
  await page.getByRole("button", { name: "다음 사진" }).click()
  await page.getByRole("button", { name: "가림 확인 완료" }).click()

  await expect(page.getByRole("heading", { name: "사진 순서와 대표 사진" })).toBeVisible()
  await page.getByRole("button", { name: "메모 작성하기" }).click()
  await page.getByLabel("오늘의 수련 메모").fill("어깨와 흉곽을 천천히 열어간 차분한 저녁 수련")
  await page.getByLabel("꼭 포함할 내용").fill("호흡")
  await page.getByLabel("피할 내용").fill("치료, 완치")
  await page.getByRole("button", { name: "AI 이해 내용 만들기" }).click()

  await expect(page.getByRole("heading", { name: "AI가 이해한 오늘의 수련" })).toBeVisible()
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
    await expect(card.locator(".result-image-card__caption")).not.toHaveText("")
  }

  await page.getByRole("button", { name: "사진 설명 늘리기" }).click()
  await expect(page.getByText("사진 설명을 보강했어요")).toBeVisible()
  await expect(page.getByText("최근 변경 · 네이버 본문")).toBeVisible()
  await expect(page.getByLabel("본문 편집")).toHaveValue(persistedBody)
  const bodyPreview = page.locator(".rewrite-preview p")
  await expect(bodyPreview).toHaveText(persistedBody)
  await expect(bodyPreview).toHaveCSS("-webkit-line-clamp", "4")
  expect(await bodyPreview.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)

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
  await page.reload()
  await expect(page.getByText("작성 중인 글을 복원했어요")).toBeVisible()
  await expect(page.getByRole("tab", { name: "네이버 블로그" })).toBeVisible()
})
