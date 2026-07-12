import { expect, test, type Page } from "@playwright/test"
import path from "node:path"

const fixturePhoto = path.resolve("public/icons/app-icon-512.png")

async function createTwoChannelPost(page: Page) {
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

  await expect(page.getByText("네이버 글이 준비됐어요")).toBeVisible()
  await page.getByRole("tab", { name: "인스타그램" }).click()
  await expect(page.getByText("인스타그램 글이 준비됐어요")).toBeVisible()
}

test("protects, authenticates, refreshes, and logs out", async ({ page }, testInfo) => {
  await page.goto("/")
  await expect(page).toHaveURL(/\/login/)

  await page.getByLabel("아이디").fill("studio-user")
  await page.getByLabel("비밀번호").fill("wrong-password")
  await page.getByRole("button", { name: "로그인" }).click()
  await expect(page.getByRole("alert")).toContainText("아이디 또는 비밀번호")

  await page.getByLabel("비밀번호").fill("test-password")
  await page.getByRole("button", { name: "로그인" }).click()
  await expect(page.getByRole("button", { name: "새 글 만들기" })).toBeVisible()

  await page.reload()
  await expect(page.getByRole("button", { name: "새 글 만들기" })).toBeVisible()

  if (testInfo.project.name === "mobile-chromium") {
    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(horizontalOverflow).toBe(false)
  }

  if (testInfo.project.name === "desktop-chromium") await createTwoChannelPost(page)

  await page.getByRole("button", { name: "로그아웃" }).click()
  await expect(page).toHaveURL(/\/login/)
  await page.goto("/")
  await expect(page).toHaveURL(/\/login/)
})
