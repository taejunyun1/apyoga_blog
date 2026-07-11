import { Blob as NodeBlob } from "node:buffer"
import { afterEach, describe, expect, it } from "vitest"
import { DexieStudioRepository } from "@/adapters/dexie-repository"
import { createDraft } from "@/domain/studio"
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
})
