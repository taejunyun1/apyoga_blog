import { createPinia, setActivePinia } from "pinia"
import { nextTick } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAutosave } from "@/features/studio/composables/use-autosave"
import { configureStudioServices, resetStudioServices, useStudioStore } from "@/features/studio/studio-store"
import { InMemoryRepository } from "../helpers/in-memory-repository"

beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  resetStudioServices()
})

afterEach(() => {
  vi.useRealTimers()
  resetStudioServices()
})

describe("draft autosave", () => {
  it("persists a changed draft after 400ms of quiet time", async () => {
    const repository = new InMemoryRepository()
    configureStudioServices({ repository })
    const store = useStudioStore()
    await store.create("2026-07-11T00:00:00.000Z")
    repository.saveCalls = 0
    const stop = useAutosave(store)

    if (store.draft) store.draft.sourceMemo = "호흡에 집중한 저녁 수련"
    await nextTick()
    await vi.advanceTimersByTimeAsync(399)
    expect(repository.saveCalls).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(repository.saveCalls).toBe(1)

    stop()
  })
})
