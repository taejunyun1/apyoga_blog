import { render, screen } from "@testing-library/vue"
import { describe, expect, it } from "vitest"
import UsageSummary from "@/features/studio/UsageSummary.vue"

const usage = {
  inputTokens: 120,
  cachedInputTokens: 20,
  outputTokens: 125,
  totalTokens: 245,
  estimatedKrw: 123,
  requestCount: 2,
}

describe("UsageSummary", () => {
  it("renders project totals with Korean number formatting", () => {
    render(UsageSummary, { props: { usage, scope: "project" } })

    expect(screen.getByRole("heading", { name: "프로젝트 AI 사용량" })).toBeTruthy()
    expect(screen.getByText("총 245 토큰")).toBeTruthy()
    expect(screen.getByText("입력 120 토큰")).toBeTruthy()
    expect(screen.getByText("캐시 입력 20 토큰")).toBeTruthy()
    expect(screen.getByText("출력 125 토큰")).toBeTruthy()
    expect(screen.getByText("요청 2회")).toBeTruthy()
    expect(screen.getByText("추정 비용 123원")).toBeTruthy()
  })

  it("labels a draft summary separately", () => {
    render(UsageSummary, {
      props: {
        usage: { ...usage, totalTokens: 10_245, estimatedKrw: 12_340 },
        scope: "draft",
      }
    })

    expect(screen.getByRole("heading", { name: "이번 글 AI 사용량" })).toBeTruthy()
    expect(screen.getByText("총 10,245 토큰")).toBeTruthy()
    expect(screen.getByText("추정 비용 12,340원")).toBeTruthy()
  })
})
