# Naver Title and Body Rewrite with Save-to-Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `최근 글과 다르게` atomically rewrite the selected Naver title and 500+ character body from the photo brief, then let the user save the result and return to the home screen in one action.

**Architecture:** Keep the existing single-section rewrite path intact and add a dedicated structured title/body rewrite contract across the Cloudflare function, OpenAI adapter, local fallback, and Pinia store. The store applies the pair only after validation and rolls back both values on review or persistence failure. The result UI renders a paired preview, while the save action navigates only after finalization and delivers a one-time flash toast on HomeView.

**Tech Stack:** Vue 3, TypeScript, Pinia, OpenAI Responses API, Cloudflare Pages Functions, Vitest, Testing Library, Playwright, Wrangler

## Global Constraints

- `최근 글과 다르게` changes the selected Naver title and Naver body together.
- The Naver body remains at least 500 trimmed characters.
- Photo context comes only from the confirmed text brief; no image data URL is sent during rewriting.
- Intro options, hashtags, class information, image placements, and image captions remain unchanged.
- A failed title/body generation, review, or save restores both previous values.
- New copy must exclude configured avoided expressions, medical guarantees, and direct photo-scene narration.
- The result footer action saves history before navigating to HomeView.
- Failed finalization remains on the result screen and shows the existing error banner.
- HomeView shows `작성 이력에 저장했어요` exactly once after successful navigation.
- Existing single-section rewrite actions and the header home icon remain available.

---

## File Structure

- Modify `functions/lib/content-types.ts`: define the structured server request and response types.
- Modify `functions/lib/openai-content.ts`: issue and validate one structured OpenAI title/body request.
- Modify `functions/api/content/rewrite.ts`: validate and route the new request kind without changing legacy requests.
- Modify `src/domain/ports.ts`: expose the title/body rewrite capability to the store.
- Modify `src/adapters/local-ai-provider.ts`: provide a safe atomic local fallback pair.
- Modify `src/adapters/openai-provider.ts`: send, parse, validate, and fall back for the new remote request.
- Modify `src/features/studio/studio-store.ts`: construct photo context, apply the pair atomically, review, persist, and roll back.
- Modify `src/features/studio/rewrite-actions.ts`: map the existing button to the new paired action and paired feedback.
- Modify `src/features/studio/RewriteResultPreview.vue`: render either a single rewrite or a title/body pair.
- Modify `src/features/studio/ResultEditor.vue`: expose the renamed final action and paired preview.
- Modify `src/views/StudioView.vue`: build paired preview state and navigate only after successful finalization.
- Modify `src/views/HomeView.vue`: consume a one-time save flash query and show the existing toast.
- Modify `src/app/styles.css`: clamp only the paired body preview and preserve mobile touch sizing.
- Modify focused unit, component, and browser tests listed in each task.

### Task 1: Structured Cloudflare and OpenAI Rewrite Contract

**Files:**
- Modify: `functions/lib/content-types.ts`
- Modify: `functions/lib/openai-content.ts`
- Modify: `functions/api/content/rewrite.ts`
- Test: `tests/unit/openai-rewrite.test.ts`
- Test: `tests/unit/content-rewrite-function.test.ts`

**Interfaces:**
- Produces: `RewriteNaverTitleAndBodyContentInput` with `kind: "naver-title-body"`.
- Produces: `RewrittenNaverTitleAndBodyContent` with exact keys `title` and `body`.
- Produces: `requestOpenAINaverTitleAndBodyRewrite(input, env, options)`.
- Guarantees: one OpenAI Responses API call returns a validated pair; legacy section rewrites remain unchanged.

- [x] **Step 1: Write failing OpenAI request and validation tests**

Add a shared input and tests to `tests/unit/openai-rewrite.test.ts`:

```ts
const titleBodyInput: RewriteNaverTitleAndBodyContentInput = {
  kind: "naver-title-body",
  instruction: "최근 글과 다르게",
  currentTitle: "호흡으로 돌아본 일요일 수련",
  currentBody: "기존 본문 ".repeat(80),
  memo: "어깨와 흉곽의 감각을 살핀 일요일 수련",
  photoContext: "전체 분위기: 따뜻하고 고요함\n사진 설명: 우드 바닥과 싱잉볼, 함께 수련하는 공간",
  avoid: "치료",
  tone: "emotional",
}

it("requests one structured Naver title and body rewrite grounded in photo context", async () => {
  const fetcher = vi.fn().mockResolvedValue(openAIResponse({
    title: "고요한 공간에서 이어진 일요일의 호흡",
    body: "새로운 감성 본문 ".repeat(60),
  }))

  const result = await requestOpenAINaverTitleAndBodyRewrite(titleBodyInput, { OPENAI_API_KEY: "test-key" }, {
    fetcher,
    safetyIdentifier: "safe-user",
  })

  expect(result.title).toBe("고요한 공간에서 이어진 일요일의 호흡")
  expect(result.body.length).toBeGreaterThanOrEqual(500)
  const request = JSON.parse(fetcher.mock.calls[0][1].body)
  expect(request.instructions).toContain(titleBodyInput.photoContext)
  expect(request.text.format.name).toBe("rewrite_naver_title_body")
})

it.each([
  [{ title: titleBodyInput.currentTitle, body: "새 본문 ".repeat(100) }, "이전과 다른 제목"],
  [{ title: "새 제목", body: titleBodyInput.currentBody }, "이전과 다른 본문"],
  [{ title: "새 제목", body: "짧은 본문" }, "500자 이상"],
  [{ title: "치료를 약속하는 제목", body: "새 본문 ".repeat(100) }, "금지 표현"],
  [{ title: "새 제목", body: `사진 속 장면은 ${"호흡 ".repeat(130)}` }, "사진 장면"],
])("rejects an invalid paired rewrite", (value, message) => {
  expect(() => validateNaverTitleAndBodyRewrite(value, titleBodyInput)).toThrow(message)
})
```

- [x] **Step 2: Run the focused OpenAI tests and verify RED**

Run: `npm test -- --run tests/unit/openai-rewrite.test.ts`

Expected: FAIL because the new request type, request function, and validator do not exist.

- [x] **Step 3: Add server types and one-call OpenAI implementation**

Add to `functions/lib/content-types.ts`:

```ts
export interface RewriteNaverTitleAndBodyContentInput {
  kind: "naver-title-body"
  instruction: string
  currentTitle: string
  currentBody: string
  memo: string
  photoContext: string
  avoid: string
  tone: GenerateContentInput["tone"]
}

export interface RewrittenNaverTitleAndBodyContent {
  title: string
  body: string
}
```

Add `requestOpenAINaverTitleAndBodyRewrite` to `functions/lib/openai-content.ts`. It must use the same model, safety identifier, retryable error mapping, `store: false`, and response parsing as `requestOpenAIRewrite`, but use this prompt and schema:

```ts
function naverTitleAndBodyRewritePrompt(input: RewriteNaverTitleAndBodyContentInput, retryInstruction?: string): string {
  return [
    "A.P YOGA 네이버 글의 현재 제목과 본문을 함께 재작성하세요.",
    "도입부, 해시태그, 수업 안내, 사진 배치 정보는 만들거나 변경하지 마세요.",
    `재작성 요청: ${input.instruction}`,
    `수련 메모: ${input.memo}`,
    `확인된 사진 맥락:\n${input.photoContext}`,
    `문체 톤: ${input.tone}`,
    `금지 표현: ${input.avoid}`,
    "제목과 본문은 기존과 모두 달라야 하며 서로 같은 흐름을 가져야 합니다.",
    "본문은 500자 이상이며 사진 장면을 설명하거나 나열하지 말고 분위기와 감각을 감성적인 발행 문장으로 연결하세요.",
    "치료·완치·교정 보장 같은 의료적 단정을 피하세요.",
    retryInstruction?.trim(),
  ].filter(Boolean).join("\n")
}

function naverTitleAndBodyRewriteSchema(): JsonSchema {
  return {
    type: "json_schema",
    name: "rewrite_naver_title_body",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "body"],
      properties: {
        title: { type: "string", minLength: 1 },
        body: { type: "string", minLength: 500 },
      },
    },
  }
}
```

Implement `validateNaverTitleAndBodyRewrite` using `hasExactKeys`, trimmed comparison against both current values, the 500-character rule, `forbiddenExpressions`, `hasMedicalClaim`, and the existing `hasPhotoNarration` predicate. Return trimmed `{ title, body }` only after every check succeeds.

- [x] **Step 4: Write failing Cloudflare handler tests**

Add to `tests/unit/content-rewrite-function.test.ts`:

```ts
it("routes a valid title-body request to one paired dependency", async () => {
  const rewriteTitleAndBody = vi.fn().mockResolvedValue({ title: "새 제목", body: "새 본문 ".repeat(100) })
  const response = await handleContentRewrite(sameOriginRequest(titleBodyInput), env, {
    rewrite: vi.fn(),
    rewriteTitleAndBody,
    safetyIdentifier: () => "safe-user",
  })

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    source: "openai",
    data: { title: "새 제목", body: "새 본문 ".repeat(100) },
  })
  expect(rewriteTitleAndBody).toHaveBeenCalledTimes(1)
})

it("rejects malformed title-body request fields", async () => {
  const response = await handleContentRewrite(sameOriginRequest({ ...titleBodyInput, photoContext: "" }), env, dependencies)
  expect(response.status).toBe(400)
})
```

- [x] **Step 5: Run the handler tests and verify RED**

Run: `npm test -- --run tests/unit/content-rewrite-function.test.ts`

Expected: FAIL because the function handler does not recognize `kind: "naver-title-body"` or the paired dependency.

- [x] **Step 6: Route and retry paired requests in the Cloudflare function**

Extend `RewriteDependencies` in `functions/api/content/rewrite.ts`:

```ts
interface RewriteDependencies {
  rewrite: typeof requestOpenAIRewrite
  rewriteTitleAndBody: typeof requestOpenAINaverTitleAndBodyRewrite
  safetyIdentifier(): string | Promise<string>
}
```

Validate the paired request first when `value.kind === "naver-title-body"`, requiring exact keys, bounded non-empty `instruction`, `currentTitle`, `currentBody`, `memo`, `photoContext`, and `tone`; allow an empty bounded `avoid` string. Branch before the legacy retry loop and retry the paired dependency at most twice using the same corrective retry instruction. Return `{ source: "openai", data: { title, body } }` on success and the existing 502 response on exhausted retryable failure.

- [x] **Step 7: Run both server test files and verify GREEN**

Run: `npm test -- --run tests/unit/openai-rewrite.test.ts tests/unit/content-rewrite-function.test.ts`

Expected: all focused server tests pass.

- [x] **Step 8: Commit the server contract**

```bash
git add functions/lib/content-types.ts functions/lib/openai-content.ts functions/api/content/rewrite.ts tests/unit/openai-rewrite.test.ts tests/unit/content-rewrite-function.test.ts
git commit -m "2026-07-14 네이버 제목 본문 묶음 재작성 API 추가"
```

### Task 2: Client Provider and Local Atomic Fallback

**Files:**
- Modify: `src/domain/ports.ts`
- Modify: `src/adapters/local-ai-provider.ts`
- Modify: `src/adapters/openai-provider.ts`
- Test: `tests/unit/local-ai-provider.test.ts`
- Test: `tests/unit/openai-provider.test.ts`

**Interfaces:**
- Produces: `RewriteNaverTitleAndBodyInput` and `RewriteNaverTitleAndBodyOutput`.
- Produces: `AIProvider.rewriteNaverTitleAndBody(input)`.
- Guarantees: remote success returns one validated pair; transport, 5xx, or malformed output returns one local pair; 401/403 redirects to login.

- [x] **Step 1: Write failing local and remote provider tests**

Add tests proving the local pair differs and stays valid:

```ts
it("rewrites a Naver title and 500-character body together", async () => {
  const input = {
    currentTitle: "기존 제목",
    currentBody: "기존 본문 ".repeat(100),
    instruction: "최근 글과 다르게",
    memo: "호흡과 어깨 감각을 살핀 수련",
    photoContext: "따뜻한 우드 바닥과 고요한 수련 분위기",
    avoid: "치료",
    tone: "emotional" as const,
  }
  const result = await new LocalAIProvider().rewriteNaverTitleAndBody(input)
  expect(result.title).not.toBe(input.currentTitle)
  expect(result.body).not.toBe(input.currentBody)
  expect(result.body.length).toBeGreaterThanOrEqual(500)
})
```

Add remote parsing and fallback tests:

```ts
it("posts one structured request and returns the paired response", async () => {
  const fetcher = vi.fn().mockResolvedValue(jsonResponse({ source: "openai", data: remotePair }))
  const provider = new OpenAIProvider({ fetcher, local })
  await expect(provider.rewriteNaverTitleAndBody(input)).resolves.toEqual(remotePair)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ kind: "naver-title-body" })
})

it.each(["network", "server", "malformed"])("uses the local pair for %s failure", async (failure) => {
  const localPair = vi.spyOn(local, "rewriteNaverTitleAndBody")
  const provider = new OpenAIProvider({ fetcher: failingFetcher(failure), local })
  const result = await provider.rewriteNaverTitleAndBody(input)
  expect(localPair).toHaveBeenCalledWith(input)
  expect(result.body.length).toBeGreaterThanOrEqual(500)
})
```

- [x] **Step 2: Run provider tests and verify RED**

Run: `npm test -- --run tests/unit/local-ai-provider.test.ts tests/unit/openai-provider.test.ts`

Expected: FAIL because the client types and provider methods do not exist.

- [x] **Step 3: Add the client port and local paired implementation**

Add to `src/domain/ports.ts`:

```ts
export interface RewriteNaverTitleAndBodyInput {
  currentTitle: string
  currentBody: string
  instruction: string
  memo: string
  photoContext: string
  avoid: string
  tone: Tone
}

export interface RewriteNaverTitleAndBodyOutput {
  title: string
  body: string
}

export interface AIProvider {
  analyzeImages(input: AnalyzeImagesInput): Promise<ContentBrief>
  generateNaver(input: ChannelInput): Promise<NaverOutput>
  generateInstagram(input: ChannelInput): Promise<InstagramOutput>
  rewriteSection(input: RewriteInput): Promise<RewriteOutput>
  rewriteNaverTitleAndBody(input: RewriteNaverTitleAndBodyInput): Promise<RewriteNaverTitleAndBodyOutput>
  review(input: { text: string }): Promise<ReviewOutput>
}
```

Implement the local method by obtaining a different safe title from the existing title candidate logic and obtaining a safe 500+ character body through the existing body rewrite path with `instruction: "사진 분위기 더하기"` and `memo: `${input.memo}\n${input.photoContext}``. Validate both values before returning. Do not mutate `input`.

- [x] **Step 4: Add remote request, parsing, and fallback**

In `src/adapters/openai-provider.ts`, post this exact payload shape:

```ts
{
  kind: "naver-title-body",
  instruction: input.instruction,
  currentTitle: input.currentTitle,
  currentBody: input.currentBody,
  memo: input.memo,
  photoContext: input.photoContext,
  avoid: input.avoid,
  tone: input.tone,
}
```

Parse only `{ source: "openai", data: { title, body } }` with exact keys. Require trimmed non-empty text, both values different from their inputs, body length at least 500, and `isSafePublishableCopy([title, body], input.avoid)`. On transport failure, non-auth non-OK status, or invalid data, call `local.rewriteNaverTitleAndBody(input)`. Preserve the existing login redirect behavior for 401/403.

- [x] **Step 5: Run provider tests and verify GREEN**

Run: `npm test -- --run tests/unit/local-ai-provider.test.ts tests/unit/openai-provider.test.ts`

Expected: all client provider tests pass.

- [x] **Step 6: Commit the client providers**

```bash
git add src/domain/ports.ts src/adapters/local-ai-provider.ts src/adapters/openai-provider.ts tests/unit/local-ai-provider.test.ts tests/unit/openai-provider.test.ts
git commit -m "2026-07-14 제목 본문 묶음 재작성 제공자 연결"
```

### Task 3: Atomic Store Mutation and Rollback

**Files:**
- Modify: `src/features/studio/studio-store.ts`
- Test: `tests/unit/studio-store.test.ts`

**Interfaces:**
- Produces: `StudioRewriteOutput = RewriteOutput | { section: "titleAndBody"; title: string; body: string }`.
- Consumes: `AIProvider.rewriteNaverTitleAndBody` from Task 2.
- Guarantees: title and body become visible only as one valid pair; existing Naver auxiliary fields remain byte-for-byte unchanged; any downstream failure restores the snapshot.

- [x] **Step 1: Write failing atomic store tests**

Add tests to `tests/unit/studio-store.test.ts` using a generated ready draft:

```ts
it("rewrites the selected Naver title and body as one photo-grounded pair", async () => {
  const before = structuredClone(store.draft!.naver.data!)
  const rewrite = vi.spyOn(ai, "rewriteNaverTitleAndBody").mockResolvedValue({
    title: "고요한 공간에서 다시 만난 호흡",
    body: "사진 분위기를 감각으로 풀어낸 새 본문 ".repeat(50),
  })

  const result = await store.rewrite({ channel: "naver", section: "titleAndBody", instruction: "최근 글과 다르게" })

  expect(result).toMatchObject({ section: "titleAndBody", title: "고요한 공간에서 다시 만난 호흡" })
  expect(store.draft!.naver.data!.titles[0]).not.toBe(before.titles[0])
  expect(store.draft!.naver.data!.body).not.toBe(before.body)
  expect(store.draft!.naver.data!.introOptions).toEqual(before.introOptions)
  expect(store.draft!.naver.data!.hashtags).toEqual(before.hashtags)
  expect(store.draft!.naver.data!.imagePlacements).toEqual(before.imagePlacements)
  expect(rewrite.mock.calls[0][0].photoContext).toContain(store.draft!.brief!.overallMood)
})

it.each(["provider", "review", "save"])("restores both values after %s failure", async (failure) => {
  const before = structuredClone(store.draft!.naver)
  arrangeTitleBodyFailure(failure, services)
  await expect(store.rewrite({ channel: "naver", section: "titleAndBody", instruction: "최근 글과 다르게" })).rejects.toThrow()
  expect(store.draft!.naver).toEqual(before)
})
```

Also add validation cases for unchanged title, unchanged body, body shorter than 500 characters, avoided expressions, and increased medical claims. Each case must assert both original values remain unchanged.

- [x] **Step 2: Run the store tests and verify RED**

Run: `npm test -- --run tests/unit/studio-store.test.ts`

Expected: FAIL because `titleAndBody` is treated as an unsupported single section.

- [x] **Step 3: Implement photo context and paired validation helpers**

Add these focused helpers in `studio-store.ts`:

```ts
function rewritePhotoContext(draft: StudioDraft): string {
  const brief = draft.brief
  if (!brief) throw new Error("공통 콘텐츠 브리프가 없어요.")
  return [
    `전체 분위기: ${brief.overallMood}`,
    `본문 초점: ${brief.bodyFocus.join(", ")}`,
    ...brief.imageDescriptions.map((image) => `사진 설명: ${image.description}`),
    `메모 요약: ${brief.userMemoSummary}`,
  ].join("\n")
}

function validateTitleAndBodyCandidate(
  rewritten: RewriteNaverTitleAndBodyOutput,
  currentTitle: string,
  currentBody: string,
  avoid: string,
): void {
  if (!rewritten.title.trim() || rewritten.title.trim() === currentTitle.trim()) {
    throw new Error("이전과 다른 제목을 만들지 못했어요. 다시 시도해 주세요.")
  }
  if (!rewritten.body.trim() || rewritten.body.trim() === currentBody.trim()) {
    throw new Error("이전과 다른 본문을 만들지 못했어요. 다시 시도해 주세요.")
  }
  if (rewritten.body.trim().length < 500) {
    throw new Error("네이버 본문은 500자 이상이어야 해요. 기존 제목과 본문을 유지합니다.")
  }
  if (!isSafePublishableCopy([rewritten.title, rewritten.body], avoid)) {
    throw new Error("재작성 문구에 금지 표현 또는 의료적 단정이 포함되어 기존 제목과 본문을 유지합니다.")
  }
}
```

- [x] **Step 4: Branch inside the existing mutation queue and apply atomically**

Inside the existing `rewrite` snapshot `try`, branch before `sectionText`:

```ts
if (request.channel === "naver" && request.section === "titleAndBody") {
  const output = current.naver.data
  if (!output) throw new Error("먼저 네이버 콘텐츠를 생성해 주세요.")
  const currentTitle = output.titles[0] ?? ""
  const currentBody = output.body
  const rewritten = await services.ai.rewriteNaverTitleAndBody({
    currentTitle,
    currentBody,
    instruction: request.instruction,
    memo: current.sourceMemo,
    photoContext: rewritePhotoContext(current),
    avoid: current.avoid,
    tone: current.naverTone,
  })
  validateTitleAndBodyCandidate(rewritten, currentTitle, currentBody, current.avoid)
  output.titles[0] = rewritten.title.trim()
  output.body = rewritten.body.trim()
  await refreshReview(current)
  assertNoNewMedicalClaims(before.review, current.review)
  current.updatedAt = new Date().toISOString()
  await persistNow()
  return { section: "titleAndBody" as const, title: output.titles[0], body: output.body }
}
```

Extract the current post-review medical-claim comparison to `assertNoNewMedicalClaims` and call it from both the paired and legacy paths. Keep the existing catch block unchanged so it restores Naver, Instagram, review, and `updatedAt` for either path.

- [x] **Step 5: Run store tests and verify GREEN**

Run: `npm test -- --run tests/unit/studio-store.test.ts`

Expected: all store tests pass, including every existing single-section mutation test.

- [x] **Step 6: Commit the store behavior**

```bash
git add src/features/studio/studio-store.ts tests/unit/studio-store.test.ts
git commit -m "2026-07-14 제목 본문 원자적 재작성 및 복구 추가"
```

### Task 4: Paired Rewrite Action, Live Fields, and Preview

**Files:**
- Modify: `src/features/studio/rewrite-actions.ts`
- Modify: `src/features/studio/RewriteResultPreview.vue`
- Modify: `src/views/StudioView.vue`
- Modify: `src/app/styles.css`
- Test: `tests/unit/rewrite-actions.test.ts`
- Test: `tests/unit/result-editor.test.ts`
- Test: `tests/component/results.test.ts`
- Test: `tests/component/studio-generation-flow.test.ts`

**Interfaces:**
- Produces: paired action request `{ channel: "naver", section: "titleAndBody", instruction: "최근 글과 다르게" }`.
- Produces: discriminated `RewritePreview` variants `kind: "single"` and `kind: "title-body"`.
- Produces exact success feedback `새 제목과 본문` and `제목과 본문을 새롭게 만들었어요`.

- [x] **Step 1: Write failing action and result-flow tests**

Update the action assertion:

```ts
expect(rewriteActionsFor("naver")).toContainEqual(expect.objectContaining({
  section: "titleAndBody",
  instruction: "최근 글과 다르게",
  feedback: { preview: "새 제목과 본문", toast: "제목과 본문을 새롭게 만들었어요" },
}))
```

Add a browser-like component flow using `ControlledRewriteProvider`:

```ts
it("changes both visible Naver fields and shows a paired preview", async () => {
  const { ai } = await renderReadyResults()
  const beforeTitle = (screen.getAllByRole("radio")[0] as HTMLInputElement).value
  const beforeBody = (screen.getByLabelText("본문 편집") as HTMLTextAreaElement).value
  vi.spyOn(ai, "rewriteNaverTitleAndBody").mockResolvedValue({
    title: "따뜻한 공간에서 새롭게 이어진 호흡",
    body: "사진의 분위기를 감각과 여운으로 풀어낸 새 본문 ".repeat(45),
  })

  await userEvent.click(screen.getByRole("button", { name: "최근 글과 다르게" }))

  await screen.findByText("제목과 본문을 새롭게 만들었어요")
  expect(screen.getByLabelText("따뜻한 공간에서 새롭게 이어진 호흡")).toBeChecked()
  expect(screen.getByLabelText("본문 편집")).not.toHaveValue(beforeBody)
  expect(screen.getByText("최근 변경 · 새 제목과 본문")).toBeTruthy()
  expect(beforeTitle).not.toBe("따뜻한 공간에서 새롭게 이어진 호흡")
})
```

Update existing preview fixtures to include `kind: "single"`. Add a paired preview fixture and assert its title and body render in separate elements.

- [x] **Step 2: Run UI tests and verify RED**

Run: `npm test -- --run tests/unit/rewrite-actions.test.ts tests/unit/result-editor.test.ts tests/component/results.test.ts tests/component/studio-generation-flow.test.ts`

Expected: FAIL because the action remains title-only and the preview accepts only one text field.

- [x] **Step 3: Change the action mapping and preview types**

Change only the existing recent-content action in `rewrite-actions.ts`:

```ts
{
  channel: "naver",
  section: "titleAndBody",
  instruction: "최근 글과 다르게",
  label: "최근 글과 다르게",
  feedback: { preview: "새 제목과 본문", toast: "제목과 본문을 새롭게 만들었어요" },
}
```

Define preview variants:

```ts
export type RewritePreview =
  | { kind: "single"; section: string; label: string; text: string }
  | { kind: "title-body"; section: "titleAndBody"; label: string; title: string; body: string }
```

- [x] **Step 4: Render and build the paired preview in the view**

Render in `RewriteResultPreview.vue`:

```vue
<aside class="rewrite-preview" aria-live="polite">
  <strong>최근 변경 · {{ preview.label }}</strong>
  <template v-if="preview.kind === 'title-body'">
    <p class="rewrite-preview__title">{{ preview.title }}</p>
    <p class="rewrite-preview__body">{{ preview.body }}</p>
  </template>
  <p v-else>{{ preview.text }}</p>
</aside>
```

In `StudioView.rewriteResult`, branch on `rewritten.section === "titleAndBody"` and store a `kind: "title-body"` preview with `title` and `body`; otherwise store a `kind: "single"` preview. Preserve pending-key cleanup in `finally`.

Add CSS that clamps only `.rewrite-preview__body` to four visual lines using `display: -webkit-box`, `-webkit-line-clamp: 4`, `-webkit-box-orient: vertical`, and `overflow: hidden`. Do not clamp the actual textarea value.

- [x] **Step 5: Run UI tests and verify GREEN**

Run: `npm test -- --run tests/unit/rewrite-actions.test.ts tests/unit/result-editor.test.ts tests/component/results.test.ts tests/component/studio-generation-flow.test.ts`

Expected: all focused action and result tests pass; the displayed textarea contains the full 500+ character result.

- [x] **Step 6: Commit the paired UI**

```bash
git add src/features/studio/rewrite-actions.ts src/features/studio/RewriteResultPreview.vue src/views/StudioView.vue src/app/styles.css tests/unit/rewrite-actions.test.ts tests/unit/result-editor.test.ts tests/component/results.test.ts tests/component/studio-generation-flow.test.ts
git commit -m "2026-07-14 최근 글 제목 본문 동시 변경 화면 반영"
```

### Task 5: Save History and Return Home with One-Time Toast

**Files:**
- Modify: `src/features/studio/ResultEditor.vue`
- Modify: `src/views/StudioView.vue`
- Modify: `src/views/HomeView.vue`
- Test: `tests/component/results.test.ts`
- Test: `tests/component/studio-generation-flow.test.ts`
- Test: `tests/component/history-deletion.test.ts`

**Interfaces:**
- Produces exact button label `작성 이력에 저장하고 메인으로`.
- Produces navigation target `{ path: "/", query: { saved: "1" } }` only after `store.finalize()` resolves.
- Consumes query `saved=1`, shows `작성 이력에 저장했어요`, and immediately replaces the route without that query.

- [x] **Step 1: Write failing save/navigation tests**

Update the ResultEditor event test:

```ts
await fireEvent.click(screen.getByRole("button", { name: "작성 이력에 저장하고 메인으로" }))
expect(emitted().finalize?.[0]).toEqual([])
```

Add StudioView success and failure tests with routes for `/` and `/studio/:draftId`:

```ts
it("finalizes before navigating home", async () => {
  const { router, repository, store } = await renderReadyResultsWithHome()
  await userEvent.click(screen.getByRole("button", { name: "작성 이력에 저장하고 메인으로" }))
  await waitFor(() => expect(router.currentRoute.value.path).toBe("/"))
  expect(router.currentRoute.value.query.saved).toBe("1")
  expect(repository.history.has(store.draft!.id)).toBe(true)
})

it("stays on results when finalization fails", async () => {
  const { router, repository } = await renderReadyResultsWithHome()
  repository.finalize = async () => { throw new Error("이력 저장 실패") }
  await userEvent.click(screen.getByRole("button", { name: "작성 이력에 저장하고 메인으로" }))
  await screen.findByText("이력 저장 실패")
  expect(router.currentRoute.value.path).toMatch(/^\/studio\//)
})
```

Add a HomeView test starting at `/?saved=1` that expects the status message, waits for `router.replace`, and verifies a remount at `/` does not show it again.

- [x] **Step 2: Run navigation tests and verify RED**

Run: `npm test -- --run tests/component/results.test.ts tests/component/studio-generation-flow.test.ts tests/component/history-deletion.test.ts`

Expected: FAIL because the button still saves without navigation and HomeView does not consume the flash query.

- [x] **Step 3: Rename the footer action and navigate only on success**

Change the ResultEditor button text to `작성 이력에 저장하고 메인으로` without changing the `finalize` event.

Change `StudioView.finalizeResult`:

```ts
async function finalizeResult() {
  const completed = await run(() => store.finalize())
  if (!completed) return
  await router.push({ path: "/", query: { saved: "1" } })
}
```

The existing `run` helper already sets the error banner and returns `false` on failure, so no navigation occurs on failure.

- [x] **Step 4: Consume the flash once in HomeView**

Import `useRoute`, create `const route = useRoute()`, and replace the current mount callback with:

```ts
onMounted(async () => {
  await store.loadHome()
  if (route.query.saved !== "1") return
  showToast("작성 이력에 저장했어요")
  const query = { ...route.query }
  delete query.saved
  await router.replace({ path: "/", query })
})
```

This reuses the existing accessible toast and timer. It removes only `saved`, preserving any unrelated query entries.

- [x] **Step 5: Run navigation tests and verify GREEN**

Run: `npm test -- --run tests/component/results.test.ts tests/component/studio-generation-flow.test.ts tests/component/history-deletion.test.ts`

Expected: all focused component tests pass; successful finalization is in repository history before route change and failure stays on the Studio route.

- [x] **Step 6: Commit the save-to-home flow**

```bash
git add src/features/studio/ResultEditor.vue src/views/StudioView.vue src/views/HomeView.vue tests/component/results.test.ts tests/component/studio-generation-flow.test.ts tests/component/history-deletion.test.ts
git commit -m "2026-07-14 작성 이력 저장 후 메인 이동 추가"
```

### Task 6: Full Verification, Browser Regression, and Cloudflare Deployment

**Files:**
- Modify: `tests/e2e/studio-flow.spec.ts`

**Interfaces:**
- Verifies: real UI changes both title and body, finalization creates visible home history, and the home toast appears once.
- Produces: a passing production build and a Cloudflare Pages deployment URL.

- [x] **Step 1: Add the browser regression**

Extend the authenticated/local fixture flow in `tests/e2e/studio-flow.spec.ts`:

```ts
const oldTitle = await page.getByRole("radio").first().getAttribute("value")
const oldBody = await page.getByLabel("본문 편집").inputValue()
await page.getByRole("button", { name: "최근 글과 다르게" }).click()
await expect(page.getByText("제목과 본문을 새롭게 만들었어요")).toBeVisible()
await expect(page.getByText("최근 변경 · 새 제목과 본문")).toBeVisible()
await expect(page.getByRole("radio").first()).not.toHaveAttribute("value", oldTitle ?? "")
await expect(page.getByLabel("본문 편집")).not.toHaveValue(oldBody)

await page.getByRole("button", { name: "작성 이력에 저장하고 메인으로" }).click()
await expect(page).toHaveURL(/\/$/)
await expect(page.getByRole("status")).toContainText("작성 이력에 저장했어요")
await expect(page.getByRole("heading", { name: "최근 작성 기록" })).toBeVisible()
```

Reload after the toast query is removed and assert `작성 이력에 저장했어요` is no longer visible.

- [x] **Step 2: Run the complete automated verification**

Run:

```bash
npm run typecheck
npm run typecheck:functions
npm run test:run
npm run build
npm run test:e2e
```

Expected: both type checks succeed, every Vitest test passes, the Vite production build succeeds, and every Playwright test passes.

- [x] **Step 3: Inspect the final diff for scope and secrets**

Run:

```bash
git diff --check
git status --short
git diff --stat origin/codex/photo-aware-generation...HEAD
git diff origin/codex/photo-aware-generation...HEAD -- . ':!package-lock.json'
```

Expected: no whitespace errors, no API keys or credentials, no changes outside the design/plan, rewrite stack, result/home UI, tests, and deployment evidence.

- [x] **Step 4: Commit the browser regression**

```bash
git add tests/e2e/studio-flow.spec.ts
git commit -m "2026-07-14 제목 본문 재작성 및 메인 이동 브라우저 검증"
```

- [x] **Step 5: Push the feature branch**

Run: `git push origin codex/photo-aware-generation`

Expected: the remote branch updates successfully and the existing pull request includes all new commits.

- [x] **Step 6: Deploy to Cloudflare Pages**

Run: `npm run deploy:cloudflare`

Expected: Wrangler reports a successful deployment for `ap-yoga-content-studio` and prints a new `pages.dev` preview URL.

- [ ] **Step 7: Verify the deployed application**

Use the authenticated browser path on the new deployment and production alias. Verify login, create/open a result draft, click `최근 글과 다르게`, confirm both title and full body change, click `작성 이력에 저장하고 메인으로`, confirm the history entry and one-time toast, and refresh to confirm the toast does not repeat.

- [x] **Step 8: Record deployment evidence**

Add the final deployment URL, production URL, verification timestamp, automated command results, and manual checks to the existing pull request description or deployment evidence document, then commit only if a repository evidence file changed:

```bash
git add docs
git commit -m "2026-07-14 운영 제목 본문 재작성 및 메인 이동 검증"
git push origin codex/photo-aware-generation
```

Expected: the deployed production URL is ready for the user to test with the existing application login.

#### Deployment evidence — 2026-07-14 16:13 KST

- Preview deployment: `https://cb351b34.ap-yoga-content-studio.pages.dev`
- Production alias: `https://ap-yoga-content-studio.pages.dev`
- Deployment command: `npm run deploy:cloudflare` completed successfully on the `master` Pages branch.
- Automated verification: `npm run test:run` (45 files, 477 tests), `npm run typecheck`, `npm run typecheck:functions`, `npm run build`, and `npm run test:e2e` (6 tests) all passed.
- Public browser smoke check: the preview loads the expected login screen; unauthenticated session response is `401` as expected. Both preview and production bundles include the paired-rewrite feedback and the `작성 이력에 저장하고 메인으로` action.
- The logged-in production flow was not submitted from this automated session, so the application login can be used for the final live-content check without transmitting credentials through the test runner.
