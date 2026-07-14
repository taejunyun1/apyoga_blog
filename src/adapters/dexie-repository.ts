import Dexie, { type Table } from "dexie"
import type { StudioDraft } from "@/domain/studio"

export interface EditedImageRecord {
  id: string
  draftId: string
  blob: Blob
  expiresAt: string
}

interface StoredDraft {
  id: string
  updatedAt: string
  finalizedAt: string | null
  value: StudioDraft
}

interface HistoryRecord {
  id: string
  finalizedAt: string
  value: StudioDraft
}

class StudioDatabase extends Dexie {
  drafts!: Table<StoredDraft, string>
  images!: Table<EditedImageRecord, string>
  history!: Table<HistoryRecord, string>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      drafts: "id, updatedAt, finalizedAt",
      images: "id, draftId, expiresAt",
      history: "id, finalizedAt"
    })
  }
}

export class DexieStudioRepository {
  private readonly db: StudioDatabase

  constructor(name = "ap-yoga-content-studio") {
    this.db = new StudioDatabase(name)
  }

  async saveDraft(draft: StudioDraft, images: EditedImageRecord[] = []): Promise<void> {
    await this.db.transaction("rw", this.db.drafts, this.db.images, async () => {
      await this.db.drafts.put({ id: draft.id, updatedAt: draft.updatedAt, finalizedAt: draft.finalizedAt, value: serializableDraft(draft) })
      if (images.length > 0) await this.db.images.bulkPut(images)
    })
  }

  async getDraft(id: string): Promise<StudioDraft | undefined> {
    return (await this.db.drafts.get(id))?.value
  }

  async listDrafts(): Promise<StudioDraft[]> {
    const rows = await this.db.drafts.orderBy("updatedAt").reverse().toArray()
    return rows.filter((row) => row.finalizedAt === null).map((row) => row.value)
  }

  async getImageBlob(id: string): Promise<Blob | undefined> {
    return (await this.db.images.get(id))?.blob
  }

  async cleanupExpired(now: string): Promise<{ drafts: number; images: number }> {
    const expiredImages = await this.db.images.where("expiresAt").belowOrEqual(now).toArray()
    const draftIds = [...new Set(expiredImages.map((image) => image.draftId))]
    let deletedDrafts = 0

    await this.db.transaction("rw", this.db.drafts, this.db.images, async () => {
      await this.db.images.bulkDelete(expiredImages.map((image) => image.id))
      for (const draftId of draftIds) {
        const remaining = await this.db.images.where("draftId").equals(draftId).count()
        const draft = await this.db.drafts.get(draftId)
        if (remaining === 0 && draft && draft.value.images.length > 0) {
          await this.db.drafts.delete(draftId)
          deletedDrafts += 1
        }
      }
    })

    return { drafts: deletedDrafts, images: expiredImages.length }
  }

  async finalize(draft: StudioDraft): Promise<void> {
    if (!draft.finalizedAt) throw new Error("완료 시각이 없는 글은 이력에 저장할 수 없어요.")
    await this.db.history.put({ id: draft.id, finalizedAt: draft.finalizedAt, value: serializableDraft(draft) })
  }

  async listHistory(): Promise<StudioDraft[]> {
    return (await this.db.history.orderBy("finalizedAt").reverse().toArray()).map((row) => row.value)
  }

  async deleteHistory(id: string): Promise<void> {
    await this.db.transaction("rw", this.db.history, this.db.drafts, this.db.images, async () => {
      await this.db.history.delete(id)
      await this.db.drafts.delete(id)
      await this.db.images.where("draftId").equals(id).delete()
    })
  }

  async clearHistory(): Promise<void> {
    await this.db.transaction("rw", this.db.history, this.db.drafts, this.db.images, async () => {
      const ids = (await this.db.history.toArray()).map((row) => row.id)
      for (const id of ids) await this.db.images.where("draftId").equals(id).delete()
      await this.db.drafts.bulkDelete(ids)
      await this.db.history.bulkDelete(ids)
    })
  }

  async deleteDraft(id: string): Promise<void> {
    await this.db.transaction("rw", this.db.drafts, this.db.images, async () => {
      await this.db.drafts.delete(id)
      await this.db.images.where("draftId").equals(id).delete()
    })
  }

  async deleteImage(id: string): Promise<void> {
    await this.db.images.delete(id)
  }

  async destroy(): Promise<void> {
    this.db.close()
    await this.db.delete()
  }
}

function serializableDraft(draft: StudioDraft): StudioDraft {
  return JSON.parse(JSON.stringify(draft)) as StudioDraft
}
