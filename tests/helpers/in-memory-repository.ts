import type { EditedImageRecord } from "@/adapters/dexie-repository"
import type { StudioDraft } from "@/domain/studio"

export class InMemoryRepository {
  drafts = new Map<string, StudioDraft>()
  images = new Map<string, Blob>()
  history = new Map<string, StudioDraft>()
  saveCalls = 0

  async saveDraft(draft: StudioDraft, images: EditedImageRecord[] = []) {
    this.saveCalls += 1
    this.drafts.set(draft.id, JSON.parse(JSON.stringify(draft)) as StudioDraft)
    for (const image of images) this.images.set(image.id, image.blob)
  }

  async getDraft(id: string) { return this.drafts.get(id) }
  async listDrafts() { return [...this.drafts.values()].filter((draft) => !draft.finalizedAt) }
  async getImageBlob(id: string) { return this.images.get(id) }
  async cleanupExpired() { return { drafts: 0, images: 0 } }
  async finalize(draft: StudioDraft) { this.history.set(draft.id, JSON.parse(JSON.stringify(draft)) as StudioDraft) }
  async listHistory() { return [...this.history.values()] }
  async deleteHistory(id: string) {
    this.history.delete(id)
    this.drafts.delete(id)
  }
  async clearHistory() {
    const ids = [...this.history.keys()]
    for (const id of ids) this.drafts.delete(id)
    this.history.clear()
  }
  async deleteDraft(id: string) { this.drafts.delete(id) }
  async deleteImage(id: string) { this.images.delete(id) }
}
