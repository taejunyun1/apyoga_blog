import { watchDebounced } from "@vueuse/core"
import type { useStudioStore } from "../studio-store"

export function useAutosave(store: ReturnType<typeof useStudioStore>): () => void {
  const stop = watchDebounced(
    () => {
      if (!store.draft) return null
      const { updatedAt: _updatedAt, ...content } = store.draft
      return JSON.stringify(content)
    },
    async () => {
      if (!store.draft) return
      store.draft.updatedAt = new Date().toISOString()
      await store.saveNow()
    },
    { debounce: 400, maxWait: 1200 }
  )

  return stop
}
