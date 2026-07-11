# A.P YOGA Content Studio MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally runnable, installable Vue PWA that takes yoga photos and a short memo through masking, brief review, dual-channel content generation, partial rewrite, copy, autosave, history, and five-day image expiry.

**Architecture:** Vue views and components call a Pinia studio store; the store orchestrates typed use cases against `AIProvider`, persistence, image, face-detection, and clipboard ports. Local adapters use deterministic text generation and IndexedDB so the complete flow runs without credentials, while the same contracts can later receive OpenAI, D1, and R2 adapters.

**Tech Stack:** Vue 3, Vite, TypeScript, Pinia, Vue Router, VueUse, Dexie, Konva, vue-konva, browser-image-compression, heic2any, MediaPipe Tasks Vision, vite-plugin-pwa, Vitest, Vue Test Utils, Playwright.

## Global Constraints

- Mobile Safari is the primary target; all primary touch controls are at least 44px.
- Users can select at most 10 images and the normal path from selection to generation request targets under one minute.
- Original image files are never persisted; only canvas-rendered, metadata-free edited JPEG blobs are stored.
- Edited images expire exactly five days after creation and cleanup runs at application startup and draft-list refresh.
- Automatic face detection is advisory; manual masking and an explicit user confirmation remain available in every environment.
- Image analysis runs once per draft; rewrites never consume image blobs.
- Naver and Instagram generation settle independently so one channel can succeed while the other fails.
- The local provider is visibly labeled as a local demo and never impersonates live OpenAI output.
- Do not invent Astryx component names; use local A.P YOGA primitives and mapping-ready CSS custom properties.
- Do not implement Google login, Cloudflare Access, D1, R2, OpenAI, automatic publishing, identity recognition, Brand Memory, speech input, cost dashboards, calendars, or data export in this MVP.

---

## File Map

- `package.json`: scripts and dependencies.
- `vite.config.ts`: Vue, PWA, Vitest, and alias configuration.
- `src/domain/studio.ts`: immutable domain types and draft factory.
- `src/domain/ports.ts`: provider and browser-service interfaces.
- `src/domain/rules.ts`: ordering, expiry, and review rules.
- `src/adapters/local-ai-provider.ts`: deterministic brief, channel generation, rewrite, and review.
- `src/adapters/dexie-repository.ts`: drafts, edited image blobs, history, and expiry cleanup.
- `src/adapters/image-processor.ts`: HEIC conversion, resize, metadata stripping, JPEG export, and hashes.
- `src/adapters/mediapipe-face-detector.ts`: lazy MediaPipe initialization and face boxes.
- `src/adapters/browser-clipboard.ts`: clipboard write with explicit failure result.
- `src/features/studio/studio-store.ts`: workflow state machine and autosave orchestration.
- `src/features/studio/*.vue`: step-specific UI components.
- `src/views/HomeView.vue`: new draft, restore, history, and expiry overview.
- `src/views/StudioView.vue`: step router and bottom action bar.
- `src/app/*`: app bootstrap, routes, shell, and styling.
- `tests/unit/*`: domain, provider, image, and persistence contracts.
- `tests/component/*`: interaction and partial-success contracts.
- `tests/e2e/studio-flow.spec.ts`: complete browser journey.

---

### Task 1: Scaffold the Tested Vue PWA Shell

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `src/env.d.ts`
- Create: `src/app/main.ts`
- Create: `src/app/App.vue`
- Create: `src/app/router.ts`
- Create: `src/app/styles.css`
- Create: `src/views/HomeView.vue`
- Create: `src/views/StudioView.vue`
- Create: `scripts/generate-icons.mjs`
- Copy: `public/app-icon.svg`
- Create: `public/icons/app-icon-180.png`
- Create: `public/icons/app-icon-192.png`
- Create: `public/icons/app-icon-512.png`
- Test: `tests/component/app-shell.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: Vue application routes `/` and `/studio/:draftId`, CSS tokens, test environment, and installable PWA metadata.

- [ ] **Step 1: Create the package manifest and configuration**

Create `package.json` with scripts `dev`, `build`, `preview`, `test`, `test:run`, `test:e2e`, and `typecheck`; runtime dependencies listed in the Tech Stack; and development dependencies for Vue, Vite, Vitest, jsdom, TypeScript, Playwright, and Vue Test Utils.

Create `vite.config.ts` with this contract and register `VueKonva` using `app.use(VueKonva)` in `src/app/main.ts`:

```ts
export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "A.P YOGA Content Studio",
        short_name: "AP Content",
        display: "standalone",
        theme_color: "#F6F1E8",
        background_color: "#F6F1E8",
        icons: [
          { src: "/icons/app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: "/icons/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
        ]
      }
    })
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "jsdom", setupFiles: ["./tests/setup.ts"] }
})
```

- [ ] **Step 2: Write the failing shell test**

```ts
it("shows the product name and new draft action", async () => {
  renderAppAt("/")
  expect(screen.getByText("A.P YOGA Content Studio")).toBeTruthy()
  expect(screen.getByRole("button", { name: "새 글 만들기" })).toBeTruthy()
})
```

- [ ] **Step 3: Run the shell test and verify failure**

Run: `npm run test:run -- tests/component/app-shell.test.ts`

Expected: FAIL because the app bootstrap and route components do not exist.

- [ ] **Step 4: Implement the minimum app shell**

`App.vue` must render `RouterView`; `HomeView.vue` must render the icon, product name, `로컬 기능형 MVP` badge, new-draft button, empty drafts section, and five-day privacy note. `StudioView.vue` initially renders a route-valid shell inside the same layout. `styles.css` must define the five approved icon colors as `--ap-*` variables, a 44px control minimum, a 760px content maximum, focus-visible rings, safe-area padding, reduced-motion behavior, and mobile/desktop responsive rules. `scripts/generate-icons.mjs` must use `sharp` to render the approved SVG at 180, 192, and 512px; run it once before the build test.

- [ ] **Step 5: Run verification**

Run: `npm run typecheck && npm run test:run -- tests/component/app-shell.test.ts && npm run build`

Expected: all commands exit 0; `dist/manifest.webmanifest` and the app shell are generated.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json index.html tsconfig.json vite.config.ts scripts/generate-icons.mjs public src/app src/views tests/setup.ts tests/component/app-shell.test.ts
git commit -m "feat: scaffold content studio PWA"
```

---

### Task 2: Define Domain Contracts and Deterministic AI Behavior

**Files:**
- Create: `src/domain/studio.ts`
- Create: `src/domain/ports.ts`
- Create: `src/domain/rules.ts`
- Create: `src/adapters/local-ai-provider.ts`
- Test: `tests/unit/domain-rules.test.ts`
- Test: `tests/unit/local-ai-provider.test.ts`

**Interfaces:**
- Consumes: no earlier runtime interface.
- Produces: `StudioDraft`, `StudioImage`, `FaceMask`, `ContentBrief`, `NaverOutput`, `InstagramOutput`, `ReviewOutput`, `AIProvider`, `createDraft()`, `reorderImages()`, `setCoverImage()`, `expiresAtFor()`, and `LocalAIProvider`.

- [ ] **Step 1: Write failing domain tests**

```ts
it("keeps exactly one cover after reordering", () => {
  const images = fixtures.images(3)
  expect(setCoverImage(reorderImages(images, 2, 0), images[1].id).filter(i => i.isCover)).toHaveLength(1)
})

it("expires edited images five days after creation", () => {
  expect(expiresAtFor("2026-07-11T00:00:00.000Z")).toBe("2026-07-16T00:00:00.000Z")
})
```

```ts
it("generates both channel shapes from one confirmed brief", async () => {
  const provider = new LocalAIProvider()
  const brief = await provider.analyzeImages(fixtures.analyzeInput())
  expect((await provider.generateNaver(fixtures.channelInput(brief))).titles).toHaveLength(3)
  expect((await provider.generateInstagram(fixtures.channelInput(brief))).hookOptions).toHaveLength(3)
})

it("rewrites only the requested section", async () => {
  const provider = new LocalAIProvider()
  const result = await provider.rewriteSection(fixtures.rewriteInput("naver", "intro"))
  expect(result.section).toBe("intro")
  expect(result.text).toContain("호흡")
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:run -- tests/unit/domain-rules.test.ts tests/unit/local-ai-provider.test.ts`

Expected: FAIL because domain modules do not exist.

- [ ] **Step 3: Implement exact domain types**

Define `WorkflowStep` as `"photos" | "mask" | "organize" | "memo" | "brief" | "generating" | "results"`. Define mask geometry as normalized `x`, `y`, `width`, `height`, and `rotation`; image status as `processing | ready | error`; channel status as `idle | loading | success | error`. Keep `editedBlobId` separate from any transient object URL.

`StudioDraft` must contain:

```ts
interface StudioDraft {
  id: string
  step: WorkflowStep
  title: string
  sourceMemo: string
  mustInclude: string
  avoid: string
  writingMode: WritingMode
  naverTone: Tone
  instagramTone: Tone
  images: StudioImage[]
  brief: ContentBrief | null
  briefConfirmed: boolean
  naver: ChannelResult<NaverOutput>
  instagram: ChannelResult<InstagramOutput>
  review: ReviewOutput | null
  createdAt: string
  updatedAt: string
  finalizedAt: string | null
}
```

- [ ] **Step 4: Implement `LocalAIProvider`**

The provider must derive all text from normalized memo fields and fixed Korean templates, produce three title/intro/hook options, distinct long and short channel copy, 5–8 hashtags, image placements, quality checks, and deterministic section rewrites. It must increment no image-analysis counter during `rewriteSection`; tests spy on `analyzeImages` to prove this.

- [ ] **Step 5: Run verification**

Run: `npm run typecheck && npm run test:run -- tests/unit/domain-rules.test.ts tests/unit/local-ai-provider.test.ts`

Expected: PASS with stable snapshots or exact field assertions.

- [ ] **Step 6: Commit**

```bash
git add src/domain src/adapters/local-ai-provider.ts tests/unit
git commit -m "feat: add studio domain and local AI provider"
```

---

### Task 3: Implement Secure Local Image Preparation and Persistence

**Files:**
- Create: `src/adapters/image-processor.ts`
- Create: `src/adapters/dexie-repository.ts`
- Create: `src/adapters/mediapipe-face-detector.ts`
- Create: `src/adapters/browser-clipboard.ts`
- Create: `public/models/blaze_face_short_range.tflite`
- Test: `tests/unit/image-processor.test.ts`
- Test: `tests/unit/dexie-repository.test.ts`
- Test: `tests/unit/browser-clipboard.test.ts`

**Interfaces:**
- Consumes: `DraftRepository`, `ImageRepository`, `ImageProcessor`, `FaceDetector`, and `ClipboardGateway` from `src/domain/ports.ts`.
- Produces: `prepareImage(file): Promise<PreparedImage>`, `DexieStudioRepository`, `MediaPipeFaceDetector.detect(source): Promise<DetectedFace[]>`, and `BrowserClipboard.copy(text): Promise<{ok: boolean; error?: string}>`.

- [ ] **Step 1: Write failing adapter tests**

```ts
it("rejects the eleventh image before decoding", async () => {
  await expect(validateImageSelection(fixtures.files(11))).rejects.toThrow("사진은 최대 10장")
})

it("calculates a 1280px maximum edge", () => {
  expect(containSize(4032, 3024, 1280)).toEqual({ width: 1280, height: 960 })
})
```

```ts
it("deletes only expired edited blobs and drafts", async () => {
  await repository.saveDraft(fixtures.expiredDraft())
  await repository.saveDraft(fixtures.activeDraft())
  expect(await repository.cleanupExpired("2026-07-17T00:00:00.000Z")).toEqual({ drafts: 1, images: 1 })
  expect(await repository.listDrafts()).toHaveLength(1)
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:run -- tests/unit/image-processor.test.ts tests/unit/dexie-repository.test.ts tests/unit/browser-clipboard.test.ts`

Expected: FAIL because adapter modules do not exist.

- [ ] **Step 3: Implement image preparation**

`prepareImage()` must convert HEIC/HEIF with `heic2any`, decode into an image, calculate a maximum 1280px edge, draw to a new canvas, export `image/jpeg` at quality `0.84`, calculate SHA-256, and return only the edited Blob plus width, height, hash, thumbnail URL, and expiry. Revoke transient object URLs when a draft closes.

- [ ] **Step 4: Implement Dexie persistence**

Use three tables: `drafts` keyed by `id`, `images` keyed by `id` with `draftId` and `expiresAt` indexes, and `history` keyed by `id` with `finalizedAt`. Use one transaction when saving draft metadata and edited blobs. `cleanupExpired(now)` must remove expired image rows and drafts that no longer have usable images; finalized text history remains available without blobs.

- [ ] **Step 5: Implement MediaPipe and clipboard adapters**

Lazy-load `FilesetResolver` and `FaceDetector` only on the mask step. Use `runningMode: "IMAGE"`, convert pixel boxes to normalized coordinates with 25% padding, and return an empty array plus a nonfatal diagnostic when initialization fails. Clipboard must call `navigator.clipboard.writeText` and return an explicit failure instead of throwing into the component.

- [ ] **Step 6: Run verification**

Run: `npm run typecheck && npm run test:run -- tests/unit/image-processor.test.ts tests/unit/dexie-repository.test.ts tests/unit/browser-clipboard.test.ts`

Expected: PASS; persistence tests use `fake-indexeddb` and never store original `File` objects.

- [ ] **Step 7: Commit**

```bash
git add src/adapters public/models tests/unit package.json package-lock.json
git commit -m "feat: add private image and draft adapters"
```

---

### Task 4: Build the Workflow Store and Autosave State Machine

**Files:**
- Create: `src/features/studio/studio-store.ts`
- Create: `src/features/studio/composables/use-autosave.ts`
- Modify: `src/app/main.ts`
- Modify: `src/views/HomeView.vue`
- Modify: `src/views/StudioView.vue`
- Test: `tests/unit/studio-store.test.ts`
- Test: `tests/component/draft-restore.test.ts`

**Interfaces:**
- Consumes: domain factories and all local adapter interfaces.
- Produces: `useStudioStore()` actions `create`, `load`, `addFiles`, `confirmMasks`, `reorder`, `updateMemo`, `analyze`, `generateAll`, `retryChannel`, `rewrite`, `copy`, `finalize`, and `discard`.

- [ ] **Step 1: Write failing store tests**

```ts
it("preserves the successful channel when the other channel fails", async () => {
  provider.generateInstagram.mockRejectedValue(new Error("instagram unavailable"))
  await store.generateAll()
  expect(store.draft.naver.status).toBe("success")
  expect(store.draft.instagram.status).toBe("error")
  expect(store.draft.step).toBe("results")
})

it("never analyzes images during a rewrite", async () => {
  await store.rewrite({ channel: "naver", section: "intro", instruction: "감성 줄이기" })
  expect(provider.analyzeImages).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:run -- tests/unit/studio-store.test.ts tests/component/draft-restore.test.ts`

Expected: FAIL because the store and draft UI are missing.

- [ ] **Step 3: Implement state transitions**

Guard each transition: at least one ready image before mask, `maskConfirmedAt` on every image before organize, a nonempty memo before brief analysis, and `briefConfirmed` before generation. Use `Promise.allSettled` for channel generation and store per-channel errors. `rewrite()` replaces only the requested output field.

- [ ] **Step 4: Implement debounced autosave and restore**

Use VueUse `watchDebounced` with 400ms delay and 1200ms maxWait. Save only serializable draft state; edited blobs are persisted by the image repository. On home load, call expiry cleanup before listing active drafts and finalized history. Show `임시 저장됨`, `저장 실패`, and `복원됨` status messages with timestamps.

- [ ] **Step 5: Run verification**

Run: `npm run typecheck && npm run test:run -- tests/unit/studio-store.test.ts tests/component/draft-restore.test.ts`

Expected: PASS; fake timers verify the 400ms autosave and failed-channel preservation.

- [ ] **Step 6: Commit**

```bash
git add src/app src/views src/features tests/unit/studio-store.test.ts tests/component/draft-restore.test.ts
git commit -m "feat: add resumable studio workflow"
```

---

### Task 5: Implement Upload, Face Masking, and Photo Organization UI

**Files:**
- Create: `src/features/studio/ProgressStepper.vue`
- Create: `src/features/studio/BottomActionBar.vue`
- Create: `src/features/studio/PhotoUploader.vue`
- Create: `src/features/studio/FaceMaskEditor.vue`
- Create: `src/features/studio/MaskStylePicker.vue`
- Create: `src/features/studio/PhotoOrganizer.vue`
- Create: `src/features/studio/ErrorBanner.vue`
- Modify: `src/views/StudioView.vue`
- Test: `tests/component/photo-uploader.test.ts`
- Test: `tests/component/face-mask-editor.test.ts`
- Test: `tests/component/photo-organizer.test.ts`

**Interfaces:**
- Consumes: `StudioImage`, `FaceMask`, and store actions from Task 4.
- Produces: events `files-selected`, `retry-image`, `update-masks`, `confirm-masks`, `reorder`, `set-cover`, and `remove-image`.

- [ ] **Step 1: Write failing interaction tests**

```ts
it("shows per-image success and failure without dropping successful files", async () => {
  await upload([fixtures.jpeg(), fixtures.invalidFile()])
  expect(screen.getByText("처리 완료")).toBeTruthy()
  expect(screen.getByRole("button", { name: "실패한 사진 다시 처리" })).toBeTruthy()
})
```

```ts
it("adds, selects, transforms, deletes, and undoes a mask", async () => {
  await user.click(screen.getByRole("button", { name: "얼굴 추가" }))
  await emitTransformerChange({ x: 0.2, y: 0.2, width: 0.3, height: 0.3, rotation: 15 })
  await user.click(screen.getByRole("button", { name: "가림 삭제" }))
  await user.click(screen.getByRole("button", { name: "실행 취소" }))
  expect(emittedMask()).toMatchObject({ rotation: 15 })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:run -- tests/component/photo-uploader.test.ts tests/component/face-mask-editor.test.ts tests/component/photo-organizer.test.ts`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement upload and progress UI**

Use a hidden multiple file input with `accept="image/jpeg,image/png,image/webp,image/heic,image/heif"`. Enforce 10 total images before processing. Render a card per file with `변환 중`, `압축 중`, `처리 완료`, or a concrete error and retry action. Continue to the mask step when at least one image is ready.

- [ ] **Step 4: Implement Konva mask editor**

Render the edited photo in a responsive Konva stage. Render each mask as a group: clipped blur approximation for `blur`, white ellipse for `white`, and the provided lotus/card icon for `sticker`. A selected group gets a Konva Transformer with resize and rotate enabled. Store normalized geometry after drag/transform, clamp it to image bounds, keep one-level undo snapshots, and offer `모든 얼굴에 적용` for style changes. Pinch scales the selected mask using two active pointers; mouse and one-pointer drag remain available.

- [ ] **Step 5: Implement photo organization**

Provide move-left/right controls that work with keyboard and touch, a single cover radio action, delete confirmation, face count versus mask count status, and image expiry date. Do not auto-accept any suggested cover.

- [ ] **Step 6: Run verification**

Run: `npm run typecheck && npm run test:run -- tests/component/photo-uploader.test.ts tests/component/face-mask-editor.test.ts tests/component/photo-organizer.test.ts`

Expected: PASS; all icon-only buttons have accessible names and all primary controls meet the 44px CSS contract.

- [ ] **Step 7: Commit**

```bash
git add src/features/studio src/views/StudioView.vue tests/component
git commit -m "feat: add private photo preparation flow"
```

---

### Task 6: Implement Memo, Brief, Dual Generation, Rewrite, Review, and Copy

**Files:**
- Create: `src/features/studio/MemoToneForm.vue`
- Create: `src/features/studio/ContentBriefReview.vue`
- Create: `src/features/studio/GenerationProgress.vue`
- Create: `src/features/studio/ChannelTabs.vue`
- Create: `src/features/studio/ResultEditor.vue`
- Create: `src/features/studio/RewriteActionSheet.vue`
- Create: `src/features/studio/PublishChecklist.vue`
- Create: `src/features/studio/CopyActionGroup.vue`
- Modify: `src/views/StudioView.vue`
- Test: `tests/component/content-brief-review.test.ts`
- Test: `tests/component/results.test.ts`

**Interfaces:**
- Consumes: store actions `updateMemo`, `analyze`, `generateAll`, `retryChannel`, `rewrite`, `copy`, and `finalize`.
- Produces: a complete post-generation flow and finalized local history entry.

- [ ] **Step 1: Write failing content tests**

```ts
it("requires a confirmed brief before generation", async () => {
  renderBrief({ brief: fixtures.brief(), confirmed: false })
  expect(screen.getByRole("button", { name: "두 채널 글 생성" })).toBeDisabled()
  await user.click(screen.getByRole("button", { name: "이해한 내용이 맞아요" }))
  expect(screen.getByRole("button", { name: "두 채널 글 생성" })).toBeEnabled()
})
```

```ts
it("keeps Naver visible when Instagram fails and retries only Instagram", async () => {
  renderResults({ naver: fixtures.successNaver(), instagram: fixtures.failedInstagram() })
  expect(screen.getByText("네이버 글이 준비됐어요")).toBeTruthy()
  await user.click(screen.getByRole("button", { name: "인스타그램만 다시 생성" }))
  expect(store.retryChannel).toHaveBeenCalledWith("instagram")
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:run -- tests/component/content-brief-review.test.ts tests/component/results.test.ts`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement memo and brief confirmation**

Provide the seven writing modes and three tones from the source documents, with defaults `자동 추천 + 담백하게` for Naver and `자동 추천 + 조금 감성적으로` for Instagram. Brief fields are editable; body focus and visual keywords support add and delete. Generation remains disabled until explicit confirmation.

- [ ] **Step 4: Implement dual generation and result editing**

Show the five progress labels from the UX document, channel-specific loading/error/success surfaces, Naver title and intro selectors, Instagram hook selector, editable body/captions, and per-channel hashtags. Provide rewrite actions for Naver title, intro, ending, paragraph, Instagram hook, long, short, and hashtags plus quick instructions `감성 줄이기`, `철학 줄이기`, `사진 설명 늘리기`, and `최근 글과 다르게`.

- [ ] **Step 5: Implement review and copy fallbacks**

Review must display face-mask confirmation, medical-claim rule, repetition, the exact warning `예약 정보는 운영 연동 전 확인 필요`, and photo order. Copy actions are separated into title, body/caption, hashtags, and whole output. When clipboard fails, open a labeled readonly textarea with selected text and the instruction `길게 눌러 복사해 주세요`.

- [ ] **Step 6: Run verification**

Run: `npm run typecheck && npm run test:run -- tests/component/content-brief-review.test.ts tests/component/results.test.ts`

Expected: PASS; tests prove independent channel retry, selected-section rewrite, and clipboard fallback.

- [ ] **Step 7: Commit**

```bash
git add src/features/studio src/views/StudioView.vue tests/component
git commit -m "feat: complete multichannel content workflow"
```

---

### Task 7: Verify the Full Story, Accessibility, PWA, and Handoff

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/studio-flow.spec.ts`
- Create: `tests/e2e/partial-success.spec.ts`
- Create: `README.md`
- Create: `docs/requirements-traceability.md`
- Modify: `package.json`
- Modify: `src/app/styles.css`
- Copy: `outputs/AP_YOGA_Content_Studio_MVP_Plan.md`
- Copy: `outputs/AP_YOGA_Content_Studio_MVP_Design.md`

**Interfaces:**
- Consumes: the complete local PWA.
- Produces: reproducible setup, requirement-to-evidence mapping, browser verification, and user-facing plan/design deliverables.

- [ ] **Step 1: Write the failing end-to-end flow**

```ts
test("creates and restores a two-channel yoga post", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "새 글 만들기" }).click()
  await uploadFixturePhotos(page, 2)
  await manuallyMaskFirstPhoto(page)
  await completeMemoAndBrief(page, "어깨와 흉곽을 천천히 열어간 저녁 수련")
  await page.getByRole("button", { name: "두 채널 글 생성" }).click()
  await expect(page.getByRole("tab", { name: "네이버 블로그" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "인스타그램" })).toBeVisible()
  await page.reload()
  await expect(page.getByText("작성 중인 글을 복원했어요")).toBeVisible()
})
```

- [ ] **Step 2: Run E2E and verify failure**

Run: `npm run test:e2e -- tests/e2e/studio-flow.spec.ts`

Expected: FAIL until missing integration seams, fixture helpers, or accessible names are corrected.

- [ ] **Step 3: Fix integration seams and responsive behavior**

Make the E2E flow pass at 390×844 and 1280×900 viewports. Verify safe-area insets, sticky bottom actions, keyboard focus order, no horizontal overflow, visible loading states, reduced motion, and aria-live feedback for save/copy/generation status.

- [ ] **Step 4: Write requirements traceability**

Map every included design requirement to one or more source files and an automated or manual verification command. Explicitly mark live Cloudflare/OpenAI, real Access, Brand Memory, and auto-publishing as excluded rather than implying completion.

- [ ] **Step 5: Write README and final deliverables**

README must include Node version, `npm install`, `npm run dev`, `npm run test:run`, `npm run test:e2e`, `npm run build`, local data reset instructions, privacy behavior, browser limitations, local-AI labeling, and the Cloudflare/OpenAI adapter roadmap. Copy the approved spec and this plan to `outputs/` with stable names.

- [ ] **Step 6: Run the full completion audit**

Run:

```bash
npm run typecheck
npm run test:run
npm run test:e2e
npm run build
```

Expected: every command exits 0. Inspect `dist/manifest.webmanifest`, confirm the icon path resolves, and use the browser at mobile and desktop widths to complete the core flow once with uploaded fixtures.

- [ ] **Step 7: Commit**

```bash
git add README.md docs package.json package-lock.json playwright.config.ts tests/e2e src/app/styles.css outputs
git commit -m "test: verify AP YOGA content studio MVP"
```

---

## Execution Order and Checkpoints

Execute Tasks 1–2, run their focused tests, and review the domain contracts before adapters. Execute Tasks 3–4, verify persistence and partial-success behavior, then execute Tasks 5–6 for the complete user flow. Task 7 is a requirement-by-requirement completion audit; it cannot be replaced by a narrow unit-test run.

Because this workspace does not authorize subagent delegation, use `superpowers:executing-plans` in the current session and keep this checklist updated after each verified task.
