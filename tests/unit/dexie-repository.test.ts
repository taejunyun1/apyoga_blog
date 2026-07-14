import { Blob as NodeBlob } from "node:buffer"
import { afterEach, describe, expect, it } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import { DexieStudioRepository } from "@/adapters/dexie-repository"
import { createDraft } from "@/domain/studio"
import { configureStudioServices, resetStudioServices, useStudioStore } from "@/features/studio/studio-store"
import { studioImages } from "../fixtures"

const repositories: DexieStudioRepository[] = []

function blob(parts: string[], type = "") {
  return new NodeBlob(parts, { type }) as unknown as Blob
}

function repository() {
  const instance = new DexieStudioRepository(`ap-yoga-test-${crypto.randomUUID()}`)
  repositories.push(instance)
  return instance
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => repo.destroy()))
})

describe("DexieStudioRepository", () => {
  it("normalizes legacy draft usage on store load and retains saved accumulated totals", async () => {
    const repo = repository()
    const legacy = createDraft("2026-07-11T00:00:00.000Z")
    const storedLegacy = { ...legacy } as { usage?: unknown }
    delete storedLegacy.usage
    await repo.saveDraft(storedLegacy as ReturnType<typeof createDraft>)

    setActivePinia(createPinia())
    resetStudioServices()
    configureStudioServices({ repository: repo })
    const store = useStudioStore()
    await store.load(legacy.id)

    expect(store.draft?.usage).toEqual({
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedKrw: 0,
      requestCount: 0,
    })

    const accumulated = {
      ...createDraft("2026-07-11T01:00:00.000Z"),
      usage: {
        inputTokens: 40,
        cachedInputTokens: 5,
        outputTokens: 10,
        totalTokens: 50,
        estimatedKrw: 2,
        requestCount: 2,
      },
    }
    await repo.saveDraft(accumulated)

    expect((await repo.getDraft(accumulated.id))?.usage.totalTokens).toBe(50)
  })

  it("saves serializable draft state and edited blobs", async () => {
    const repo = repository()
    const draft = { ...createDraft("2026-07-11T00:00:00.000Z"), images: studioImages(1) }
    const editedBlob = blob(["edited pixels"], "image/jpeg")

    await repo.saveDraft(draft, [{ id: "blob-1", draftId: draft.id, blob: editedBlob, expiresAt: "2026-07-16T00:00:00.000Z" }])

    expect((await repo.getDraft(draft.id))?.sourceMemo).toBe("")
    expect((await repo.getImageBlob("blob-1"))?.type).toBe("image/jpeg")
  })

  it("deletes expired edited blobs and their active draft", async () => {
    const repo = repository()
    const expired = { ...createDraft("2026-07-01T00:00:00.000Z"), images: studioImages(1).map((image) => ({ ...image, expiresAt: "2026-07-06T00:00:00.000Z" })) }
    const active = { ...createDraft("2026-07-11T00:00:00.000Z"), images: studioImages(1) }
    await repo.saveDraft(expired, [{ id: "blob-1", draftId: expired.id, blob: blob(["expired"]), expiresAt: "2026-07-06T00:00:00.000Z" }])
    await repo.saveDraft(active, [{ id: "blob-active", draftId: active.id, blob: blob(["active"]), expiresAt: "2026-07-16T00:00:00.000Z" }])

    expect(await repo.cleanupExpired("2026-07-11T00:00:00.000Z")).toEqual({ drafts: 1, images: 1 })
    expect((await repo.listDrafts()).map((draft) => draft.id)).toEqual([active.id])
  })

  it("keeps finalized text history after its image expires", async () => {
    const repo = repository()
    const finalized = { ...createDraft("2026-07-01T00:00:00.000Z"), finalizedAt: "2026-07-01T01:00:00.000Z", images: studioImages(1).map((image) => ({ ...image, expiresAt: "2026-07-06T00:00:00.000Z" })) }
    await repo.saveDraft(finalized, [{ id: "blob-1", draftId: finalized.id, blob: blob(["expired"]), expiresAt: "2026-07-06T00:00:00.000Z" }])
    await repo.finalize(finalized)

    await repo.cleanupExpired("2026-07-11T00:00:00.000Z")

    expect(await repo.listHistory()).toHaveLength(1)
    expect(await repo.getImageBlob("blob-1")).toBeUndefined()
  })

  it("deletes one edited blob when a photo is removed", async () => {
    const repo = repository()
    const draft = { ...createDraft(), images: studioImages(1) }
    await repo.saveDraft(draft, [{ id: "blob-1", draftId: draft.id, blob: blob(["pixels"]), expiresAt: "2026-07-16T00:00:00.000Z" }])

    await repo.deleteImage("blob-1")

    expect(await repo.getImageBlob("blob-1")).toBeUndefined()
  })

  it("deletes one completed history record with its draft and images", async () => {
    const repo = repository()
    const completed = {
      ...createDraft("2026-07-11T00:00:00.000Z"),
      finalizedAt: "2026-07-11T01:00:00.000Z",
      images: studioImages(1)
    }
    await repo.saveDraft(completed, [{
      id: completed.images[0].editedBlobId,
      draftId: completed.id,
      blob: blob(["pixels"]),
      expiresAt: "2026-07-16T00:00:00.000Z"
    }])
    await repo.finalize(completed)

    await repo.deleteHistory(completed.id)

    expect(await repo.listHistory()).toEqual([])
    expect(await repo.getDraft(completed.id)).toBeUndefined()
    expect(await repo.getImageBlob(completed.images[0].editedBlobId)).toBeUndefined()
  })

  it("clears completed history while preserving unfinished drafts", async () => {
    const repo = repository()
    const unfinished = { ...createDraft("2026-07-11T00:00:00.000Z"), title: "작성 중" }
    const completed = {
      ...createDraft("2026-07-11T01:00:00.000Z"),
      finalizedAt: "2026-07-11T02:00:00.000Z",
      images: studioImages(1)
    }
    await repo.saveDraft(unfinished)
    await repo.saveDraft(completed, [{
      id: completed.images[0].editedBlobId,
      draftId: completed.id,
      blob: blob(["pixels"]),
      expiresAt: "2026-07-16T00:00:00.000Z"
    }])
    await repo.finalize(completed)

    await repo.clearHistory()

    expect(await repo.listHistory()).toEqual([])
    expect(await repo.getDraft(completed.id)).toBeUndefined()
    expect(await repo.getImageBlob(completed.images[0].editedBlobId)).toBeUndefined()
    expect((await repo.getDraft(unfinished.id))?.title).toBe("작성 중")
  })
})
