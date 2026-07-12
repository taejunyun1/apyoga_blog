import { expect, test, type Page } from "@playwright/test"
import path from "node:path"

const fixturePhoto = path.resolve("public/icons/app-icon-512.png")

test("creates and restores a two-channel yoga post", async ({ page }, testInfo) => {
  await page.route("**/api/content/generate", (route) => route.fulfill({ status: 503, body: "local fallback" }))
  await page.goto("/")

  await page.getByRole("button", { name: "새 글 만들기" }).click()
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

  await page.getByRole("button", { name: "도입부 감성 줄이기" }).click()
  await expect(page.getByText("문구를 변경했어요")).toBeVisible()
  await page.getByRole("tab", { name: "인스타그램" }).click()
  await expect(page.getByText("인스타그램 글이 준비됐어요")).toBeVisible()
  await expect(page.getByText("인스타그램 결과를 열었어요")).toBeVisible()

  if (testInfo.project.name === "mobile-chromium") {
    await expect(page.getByLabel("기본형 캡션")).toHaveCSS("font-size", "16px")
    await page.setViewportSize({ width: 844, height: 390 })
    await expect(page.getByLabel("기본형 캡션")).toHaveCSS("font-size", "16px")
  }

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(horizontalOverflow).toBe(false)

  await page.screenshot({ path: testInfo.outputPath("completed-flow.png"), fullPage: true })
  await page.reload()
  await expect(page.getByText("작성 중인 글을 복원했어요")).toBeVisible()
  await expect(page.getByRole("tab", { name: "네이버 블로그" })).toBeVisible()
})
