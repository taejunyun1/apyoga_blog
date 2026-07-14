# Previous History Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add permanent individual and bulk deletion for completed writing history without deleting active drafts.

**Architecture:** Extend the IndexedDB repository with transactional history cleanup operations, expose them through the Pinia studio store, and render a focused confirmation dialog from the home view. The repository owns cross-table consistency, the store updates reactive history only after successful persistence, and the UI owns confirmation, progress, error, and toast state.

**Tech Stack:** Vue 3, TypeScript, Pinia, Dexie/IndexedDB, Vitest, Testing Library, Playwright, Cloudflare Pages

## Global Constraints

- Provide both individual history deletion and deletion of all completed history.
- Every deletion is permanent and requires an explicit confirmation dialog.
- Deleting history removes matching `history`, `drafts`, and `images` data.
- Bulk deletion must preserve every unfinished draft.
- Keep record navigation and delete controls independent on desktop and mobile.
- Announce success with `role="status"` and failure with `role="alert"`.
- Do not add recovery, trash retention, checkbox selection, or server-side history storage.

---

## File Structure

- Modify `src/adapters/dexie-repository.ts`: own transactional cross-table deletion.
- Modify `src/features/studio/studio-store.ts`: expose deletion actions and update reactive history after persistence succeeds.
- Modify `tests/helpers/in-memory-repository.ts`: implement the repository contract for unit and component tests.
- Create `src/features/studio/HistoryDeleteDialog.vue`: own accessible dialog rendering, focus, Escape, backdrop, and busy behavior.
- Modify `src/views/HomeView.vue`: own deletion target, calls, success toast, and error state.
- Modify `src/app/styles.css`: add history action-row and modal styles in the existing visual system.
- Modify `tests/unit/dexie-repository.test.ts`: verify IndexedDB cleanup and unfinished-draft preservation.
- Modify `tests/unit/studio-store.test.ts`: verify reactive state changes only after repository success.
- Create `tests/component/history-deletion.test.ts`: verify the complete home-screen interaction.
- Modify `tests/e2e/studio-flow.spec.ts`: verify the real browser deletion path at desktop and mobile viewports.

### Task 1: Transactional History Repository Operations

**Files:**
- Modify: `src/adapters/dexie-repository.ts`
- Modify: `tests/helpers/in-memory-repository.ts`
- Test: `tests/unit/dexie-repository.test.ts`

**Interfaces:**
- Produces: `deleteHistory(id: string): Promise<void>`
- Produces: `clearHistory(): Promise<void>`
- Guarantees: all matching history, saved draft, and edited image rows are deleted atomically; unfinished drafts are retained.

- [ ] **Step 1: Write failing repository tests**

Add tests that finalize two drafts, retain one unfinished draft, and assert exact cleanup:

```ts
it("deletes one completed history record with its draft and images", async () => {
  const repo = repository()
  const completed = { ...createDraft("2026-07-11T00:00:00.000Z"), finalizedAt: "2026-07-11T01:00:00.000Z", images: studioImages(1) }
  await repo.saveDraft(completed, [{ id: completed.images[0].editedBlobId, draftId: completed.id, blob: blob(["pixels"]), expiresAt: "2026-07-16T00:00:00.000Z" }])
  await repo.finalize(completed)

  await repo.deleteHistory(completed.id)

  expect(await repo.listHistory()).toEqual([])
  expect(await repo.getDraft(completed.id)).toBeUndefined()
  expect(await repo.getImageBlob(completed.images[0].editedBlobId)).toBeUndefined()
})

it("clears completed history while preserving unfinished drafts", async () => {
  const repo = repository()
  const unfinished = { ...createDraft("2026-07-11T00:00:00.000Z"), title: "작성 중" }
  const completed = { ...createDraft("2026-07-11T01:00:00.000Z"), finalizedAt: "2026-07-11T02:00:00.000Z", images: studioImages(1) }
  await repo.saveDraft(unfinished)
  await repo.saveDraft(completed, [{ id: completed.images[0].editedBlobId, draftId: completed.id, blob: blob(["pixels"]), expiresAt: "2026-07-16T00:00:00.000Z" }])
  await repo.finalize(completed)

  await repo.clearHistory()

  expect(await repo.listHistory()).toEqual([])
  expect(await repo.getDraft(completed.id)).toBeUndefined()
  expect(await repo.getImageBlob(completed.images[0].editedBlobId)).toBeUndefined()
  expect((await repo.getDraft(unfinished.id))?.title).toBe("작성 중")
})
```

- [ ] **Step 2: Run repository tests and verify RED**

Run: `npm test -- --run tests/unit/dexie-repository.test.ts`

Expected: FAIL because `deleteHistory` and `clearHistory` do not exist.

- [ ] **Step 3: Implement Dexie transactions**

Add methods to `DexieStudioRepository`:

```ts
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
```

Implement matching in-memory methods using the IDs present in `history` before clearing it.

- [ ] **Step 4: Run repository tests and verify GREEN**

Run: `npm test -- --run tests/unit/dexie-repository.test.ts`

Expected: all repository tests pass.

- [ ] **Step 5: Commit repository behavior**

```bash
git add src/adapters/dexie-repository.ts tests/helpers/in-memory-repository.ts tests/unit/dexie-repository.test.ts
git commit -m "2026-07-14 완료 기록 저장 데이터 삭제 추가"
```

### Task 2: Reactive Store Deletion Actions

**Files:**
- Modify: `src/features/studio/studio-store.ts`
- Modify: `tests/helpers/in-memory-repository.ts`
- Test: `tests/unit/studio-store.test.ts`

**Interfaces:**
- Consumes: repository `deleteHistory(id)` and `clearHistory()` from Task 1.
- Produces: store `deleteHistory(id: string): Promise<void>` and `clearHistory(): Promise<void>`.
- Guarantees: `history` changes only after repository success.

- [ ] **Step 1: Write failing store tests**

```ts
it("removes one history item after repository deletion succeeds", async () => {
  const repository = new InMemoryRepository()
  const completed = { ...createDraft(), finalizedAt: "2026-07-14T01:00:00.000Z" }
  repository.history.set(completed.id, completed)
  configureStudioServices({ repository })
  const store = useStudioStore()
  await store.loadHome()

  await store.deleteHistory(completed.id)

  expect(store.history).toEqual([])
  expect(repository.history.has(completed.id)).toBe(false)
})

it("keeps history visible when repository deletion fails", async () => {
  const repository = new InMemoryRepository()
  const completed = { ...createDraft(), finalizedAt: "2026-07-14T01:00:00.000Z" }
  repository.history.set(completed.id, completed)
  repository.deleteHistory = async () => { throw new Error("삭제 실패") }
  configureStudioServices({ repository })
  const store = useStudioStore()
  await store.loadHome()

  await expect(store.deleteHistory(completed.id)).rejects.toThrow("삭제 실패")

  expect(store.history).toHaveLength(1)
})
```

Add a `clearHistory()` success case with two completed records and assert both the store and repository histories are empty. Add a failure case that assigns `repository.clearHistory = async () => { throw new Error("전체 삭제 실패") }`, expects the rejection, and asserts both records remain visible.

- [ ] **Step 2: Run store tests and verify RED**

Run: `npm test -- --run tests/unit/studio-store.test.ts`

Expected: FAIL because the store actions and repository contract are missing.

- [ ] **Step 3: Extend the contract and store**

Add to `StudioRepository`:

```ts
deleteHistory(id: string): Promise<void>
clearHistory(): Promise<void>
```

Add store actions:

```ts
async function deleteHistory(id: string) {
  await services.repository.deleteHistory(id)
  history.value = history.value.filter((item) => item.id !== id)
}

async function clearHistory() {
  await services.repository.clearHistory()
  history.value = []
}
```

Return both actions from `useStudioStore`.

- [ ] **Step 4: Run store tests and verify GREEN**

Run: `npm test -- --run tests/unit/studio-store.test.ts`

Expected: all store tests pass.

- [ ] **Step 5: Commit store behavior**

```bash
git add src/features/studio/studio-store.ts tests/unit/studio-store.test.ts
git commit -m "2026-07-14 완료 기록 삭제 상태 동기화"
```

### Task 3: Accessible Confirmation Dialog and Home Interactions

**Files:**
- Create: `src/features/studio/HistoryDeleteDialog.vue`
- Modify: `src/views/HomeView.vue`
- Modify: `src/app/styles.css`
- Create: `tests/component/history-deletion.test.ts`

**Interfaces:**
- Consumes: store `deleteHistory(id)` and `clearHistory()` from Task 2.
- Produces: `HistoryDeleteDialog` props `open`, `title`, `description`, `busy`, `error`; events `cancel`, `confirm`.
- Produces visible copy: `전체 삭제`, `취소`, `삭제`, `기록을 삭제했어요`, `모든 기록을 삭제했어요`.

- [ ] **Step 1: Write failing home interaction tests**

Mount `HomeView` with two finalized records and assert:

```ts
expect(wrapper.get("[aria-label='저녁 수련 기록 삭제']").exists()).toBe(true)
expect(wrapper.get("button.history-clear-button").text()).toBe("전체 삭제")

await wrapper.get("[aria-label='저녁 수련 기록 삭제']").trigger("click")
expect(wrapper.get("[role=alertdialog]").text()).toContain("“저녁 수련 기록” 기록을 삭제할까요?")
expect(document.activeElement).toBe(wrapper.get("[role=alertdialog] button[data-action=cancel]").element)

await wrapper.get("[role=alertdialog] button[data-action=confirm]").trigger("click")
await flushPromises()
expect(wrapper.find("[role=alertdialog]").exists()).toBe(false)
expect(wrapper.get("[role=status]").text()).toBe("기록을 삭제했어요")
expect(wrapper.text()).not.toContain("저녁 수련 기록")
```

Also assert cancellation leaves data unchanged, Escape closes the dialog, full deletion shows the record count, bulk success preserves the active-draft section, and repository failure keeps the dialog/list visible with `role="alert"`.

- [ ] **Step 2: Run component tests and verify RED**

Run: `npm test -- --run tests/component/history-deletion.test.ts`

Expected: FAIL because the controls and dialog do not exist.

- [ ] **Step 3: Build the focused dialog component**

Implement `HistoryDeleteDialog.vue` with:

```ts
const props = defineProps<{ open: boolean; title: string; description: string; busy: boolean; error: string | null }>()
const emit = defineEmits<{ cancel: []; confirm: [] }>()
const cancelButton = ref<HTMLButtonElement | null>(null)

watch(() => props.open, async (open) => {
  if (!open) return
  await nextTick()
  cancelButton.value?.focus()
})

function cancel() {
  if (!props.busy) emit("cancel")
}
```

Render `role="alertdialog"`, `aria-modal="true"`, linked title/description IDs, `data-action` attributes, backdrop self-click cancellation, Escape cancellation, and disabled buttons during deletion.

- [ ] **Step 4: Connect HomeView state and store actions**

Use a discriminated deletion target:

```ts
type DeleteTarget =
  | { kind: "one"; id: string; title: string }
  | { kind: "all"; count: number }

const deleteTarget = ref<DeleteTarget | null>(null)
const deleting = ref(false)
const deleteError = ref<string | null>(null)
const toastMessage = ref<string | null>(null)
```

On confirm, await the matching store action, close only after success, and set the exact success toast. On failure, keep the dialog open and set `deleteError` from the thrown `Error` or the fallback `기록을 삭제하지 못했어요. 다시 시도해 주세요.`.

Replace completed-history row links with a `.content-row--actionable` container containing an independent `.content-row__link` and `.history-delete-button`. Keep draft rows unchanged.

- [ ] **Step 5: Add styles in the existing visual system**

Add styles for `.section-title-row`, `.history-clear-button`, `.content-row--actionable`, `.content-row__link`, `.history-delete-button`, `.dialog-backdrop`, `.history-dialog`, `.history-dialog__actions`, `.danger-action`, and responsive touch targets. Reuse `--ap-border`, `--ap-surface`, `--ap-ink`, `--ap-muted`, `--ap-error`, `--ap-radius`, and `--ap-control-radius`; do not introduce a new palette or dependency.

- [ ] **Step 6: Run component tests and verify GREEN**

Run: `npm test -- --run tests/component/history-deletion.test.ts tests/component/draft-restore.test.ts`

Expected: all home component tests pass.

- [ ] **Step 7: Commit the UI**

```bash
git add src/features/studio/HistoryDeleteDialog.vue src/views/HomeView.vue src/app/styles.css tests/component/history-deletion.test.ts
git commit -m "2026-07-14 이전 기록 개별 및 전체 삭제 화면 추가"
```

### Task 4: Browser Regression, Visual QA, and Deployment

**Files:**
- Modify: `tests/e2e/studio-flow.spec.ts`

**Interfaces:**
- Consumes: completed deletion workflow from Tasks 1–3.
- Produces: repeatable desktop/mobile regression coverage and a deployed Cloudflare build.

- [ ] **Step 1: Add a failing E2E deletion scenario**

Seed finalized IndexedDB records in the existing authenticated E2E setup with this helper:

```ts
async function seedHistory(page: Page) {
  await page.goto("/")
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("ap-yoga-content-studio")
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction(["drafts", "history"], "readwrite")
    const drafts = transaction.objectStore("drafts")
    const history = transaction.objectStore("history")
    const unfinished = { id: "active-draft", title: "작성 중인 글", updatedAt: "2026-07-14T00:00:00.000Z", finalizedAt: null, images: [] }
    const first = { id: "history-one", title: "저녁 수련 기록", updatedAt: "2026-07-14T01:00:00.000Z", finalizedAt: "2026-07-14T01:00:00.000Z", images: [] }
    const second = { id: "history-two", title: "아침 호흡 기록", updatedAt: "2026-07-14T02:00:00.000Z", finalizedAt: "2026-07-14T02:00:00.000Z", images: [] }
    drafts.put({ id: unfinished.id, updatedAt: unfinished.updatedAt, finalizedAt: null, value: unfinished })
    for (const value of [first, second]) {
      drafts.put({ id: value.id, updatedAt: value.updatedAt, finalizedAt: value.finalizedAt, value })
      history.put({ id: value.id, finalizedAt: value.finalizedAt, value })
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
  })
  await page.reload()
}
```

Then click `저녁 수련 기록 삭제`, confirm, assert the URL remains `/` and the row is gone after reload. Click `전체 삭제`, confirm, and assert `완료한 콘텐츠가 이곳에 표시됩니다.` plus the unchanged `작성 중인 글` row.

- [ ] **Step 2: Run targeted E2E and verify RED/GREEN**

Run: `npx playwright test tests/e2e/studio-flow.spec.ts`

Expected before completing selectors/behavior: the new scenario fails; after completing the implementation: desktop and mobile projects pass.

- [ ] **Step 3: Run the full verification suite**

```bash
npm run typecheck
npm test -- --run
npm run build
npx playwright test tests/e2e/studio-flow.spec.ts
```

Expected: type checking succeeds, all unit/component tests pass, production build succeeds, and core E2E passes on desktop and mobile.

- [ ] **Step 4: Perform visual and interaction QA**

Open the home screen in Browser/IAB or the repository Playwright wrapper at desktop and `390x844`. Inspect the accepted existing home visual and the latest render with `view_image`. Compare at least: section heading/copy, record row spacing, link/delete separation, icon and pointer behavior, modal hierarchy/colors, success/error messages, focus handling, and mobile overflow. Remove temporary screenshots and automation output afterward.

- [ ] **Step 5: Commit E2E coverage**

```bash
git add tests/e2e/studio-flow.spec.ts
git commit -m "2026-07-14 이전 기록 삭제 브라우저 회귀 테스트"
```

- [ ] **Step 6: Push and deploy**

```bash
git push origin codex/photo-aware-generation
npm run deploy:cloudflare
```

Expected: the GitHub branch updates successfully and Cloudflare returns a new deployment URL. Verify the production alias follows redirects to a `200` login or app response.
