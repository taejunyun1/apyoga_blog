import { fireEvent, render, screen, waitFor } from "@testing-library/vue"
import { createPinia } from "pinia"
import { createMemoryHistory, createRouter } from "vue-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createDraft } from "@/domain/studio"
import { configureStudioServices, resetStudioServices } from "@/features/studio/studio-store"
import HomeView from "@/views/HomeView.vue"
import { InMemoryRepository } from "../helpers/in-memory-repository"

afterEach(() => {
  resetStudioServices()
  vi.restoreAllMocks()
})

function completedDraft(title: string, finalizedAt: string) {
  return {
    ...createDraft(finalizedAt),
    title,
    finalizedAt,
    updatedAt: finalizedAt
  }
}

async function renderHome(repository: InMemoryRepository, initialPath = "/") {
  configureStudioServices({ repository })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: HomeView },
      { path: "/studio/:draftId", component: { template: "<p>Studio</p>" } },
      { path: "/account/password", component: { template: "<p>Password</p>" } }
    ]
  })
  await router.push(initialPath)
  await router.isReady()
  render(HomeView, { global: { plugins: [createPinia(), router] } })
  return router
}

describe("history deletion", () => {
  it("shows the save confirmation once and removes its flash query", async () => {
    const router = await renderHome(new InMemoryRepository(), "/?saved=1")

    expect((await screen.findByRole("status")).textContent).toBe("작성 이력에 저장했어요")
    await waitFor(() => expect(router.currentRoute.value.fullPath).toBe("/"))
  })

  it("confirms and permanently deletes one completed record", async () => {
    const repository = new InMemoryRepository()
    const completed = completedDraft("저녁 수련 기록", "2026-07-14T01:00:00.000Z")
    repository.drafts.set(completed.id, completed)
    repository.history.set(completed.id, completed)
    const router = await renderHome(repository)
    await screen.findByText("저녁 수련 기록")

    expect(screen.getByRole("link", { name: /저녁 수련 기록/ }).getAttribute("href")).toBe(`/studio/${completed.id}`)
    await fireEvent.click(screen.getByRole("button", { name: "저녁 수련 기록 삭제" }))

    const dialog = screen.getByRole("alertdialog")
    expect(dialog.textContent).toContain("“저녁 수련 기록” 기록을 삭제할까요?")
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "취소" }))

    await fireEvent.click(screen.getByRole("button", { name: "삭제" }))

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(screen.queryByText("저녁 수련 기록")).toBeNull()
    expect((await screen.findByRole("status")).textContent).toBe("기록을 삭제했어요")
    expect(repository.history.has(completed.id)).toBe(false)
    expect(router.currentRoute.value.fullPath).toBe("/")
  })

  it("cancels an individual deletion without changing history", async () => {
    const repository = new InMemoryRepository()
    const completed = completedDraft("남겨둘 기록", "2026-07-14T01:00:00.000Z")
    repository.history.set(completed.id, completed)
    await renderHome(repository)
    await screen.findByText("남겨둘 기록")

    await fireEvent.click(screen.getByRole("button", { name: "남겨둘 기록 삭제" }))
    await fireEvent.click(screen.getByRole("button", { name: "취소" }))

    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(screen.getByText("남겨둘 기록")).toBeTruthy()
    expect(repository.history.has(completed.id)).toBe(true)
  })

  it("closes the confirmation dialog with Escape", async () => {
    const repository = new InMemoryRepository()
    const completed = completedDraft("키보드 기록", "2026-07-14T01:00:00.000Z")
    repository.history.set(completed.id, completed)
    await renderHome(repository)
    await screen.findByText("키보드 기록")

    await fireEvent.click(screen.getByRole("button", { name: "키보드 기록 삭제" }))
    await fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" })

    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(repository.history.has(completed.id)).toBe(true)
  })

  it("clears completed history while preserving an active draft", async () => {
    const repository = new InMemoryRepository()
    const active = { ...createDraft("2026-07-14T00:00:00.000Z"), title: "작성 중인 글" }
    const first = completedDraft("첫 번째 완료 기록", "2026-07-14T01:00:00.000Z")
    const second = completedDraft("두 번째 완료 기록", "2026-07-14T02:00:00.000Z")
    repository.drafts.set(active.id, active)
    repository.drafts.set(first.id, first)
    repository.drafts.set(second.id, second)
    repository.history.set(first.id, first)
    repository.history.set(second.id, second)
    await renderHome(repository)
    await screen.findByText("두 번째 완료 기록")

    await fireEvent.click(screen.getByRole("button", { name: "전체 삭제" }))
    expect(screen.getByRole("alertdialog").textContent).toContain("저장된 기록 2개를 모두 삭제할까요?")
    await fireEvent.click(screen.getByRole("button", { name: "삭제" }))

    await screen.findByText("완료한 콘텐츠가 이곳에 표시됩니다.")
    expect((await screen.findByRole("status")).textContent).toBe("모든 기록을 삭제했어요")
    expect(screen.getByRole("link", { name: /작성 중인 글/ })).toBeTruthy()
    expect(repository.drafts.has(active.id)).toBe(true)
    expect(repository.drafts.has(first.id)).toBe(false)
    expect(repository.drafts.has(second.id)).toBe(false)
  })

  it("keeps the dialog and history visible when deletion fails", async () => {
    const repository = new InMemoryRepository()
    const completed = completedDraft("삭제 실패 기록", "2026-07-14T01:00:00.000Z")
    repository.history.set(completed.id, completed)
    vi.spyOn(repository, "deleteHistory").mockRejectedValue(new Error("기록 저장소를 정리하지 못했어요"))
    await renderHome(repository)
    await screen.findByText("삭제 실패 기록")

    await fireEvent.click(screen.getByRole("button", { name: "삭제 실패 기록 삭제" }))
    await fireEvent.click(screen.getByRole("button", { name: "삭제" }))

    expect((await screen.findByRole("alert")).textContent).toContain("기록 저장소를 정리하지 못했어요")
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    expect(screen.getByText("삭제 실패 기록")).toBeTruthy()
  })
})
