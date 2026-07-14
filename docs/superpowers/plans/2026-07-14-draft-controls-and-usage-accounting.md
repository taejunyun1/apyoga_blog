# Draft Controls and Usage Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely delete unfinished drafts, navigate to already-completed workflow stages, and display persisted per-draft and project-wide OpenAI token usage with estimated KRW cost.

**Architecture:** The Pages Functions parse actual OpenAI Responses usage, calculate configured KRW estimates, persist non-content ledger rows in the existing D1 database, and return the request usage with content responses. The client records each successful request on the draft for per-draft totals and loads a D1 aggregate for the project total. HomeView owns unfinished-draft deletion; the shared stepper emits only completed-stage navigation requests that the store validates and persists.

**Tech Stack:** Vue 3, Pinia, TypeScript, Vitest, Testing Library, Playwright, Cloudflare Pages Functions, D1, Wrangler, OpenAI Responses API.

## Global Constraints

- Never persist prompts, generated copy, image data, API keys, or credentials in the usage ledger.
- Record only successful OpenAI Responses API completions; local fallbacks add no API usage.
- Store all estimated costs as non-negative integer KRW and label every UI amount `추정 비용`.
- Read three administrator-controlled KRW-per-million-token prices: uncached input, cached input, and output.
- Preserve the project aggregate after unfinished drafts or history records are deleted.
- Unfinished-draft deletion permanently removes only that draft and its local edited images, after confirmation.
- The stepper only permits navigation to a prior stable workflow stage. It never permits a future stage, the `generating` stage, or a transition while busy.
- Keep all existing auth, rewrite, local fallback, history deletion, and save-to-home behavior unchanged.

---

## File Structure

- Modify `functions/lib/env.ts`: type D1 aggregate queries and three cost-rate environment values.
- Modify `functions/lib/http.ts`: add a same-origin check for authenticated GET endpoints.
- Create `functions/lib/usage.ts`: parse actual Responses usage, calculate integer KRW, insert ledger rows, and summarize per-project totals.
- Modify `functions/lib/openai-content.ts` and `functions/lib/openai-image-analysis.ts`: return validated output plus parsed OpenAI token usage.
- Modify `functions/api/content/generate.ts`, `functions/api/content/analyze-images.ts`, and `functions/api/content/rewrite.ts`: require `draftId`, record usage, and add `usage` to their success envelopes.
- Create `functions/api/usage.ts`: return the protected aggregate ledger summary.
- Create `migrations/0002_api_usage.sql`: create the privacy-safe D1 ledger and indexes.
- Modify `src/domain/studio.ts` and `src/domain/ports.ts`: define serializable usage totals and generic AI result envelopes.
- Modify `src/adapters/openai-provider.ts` and `src/adapters/local-ai-provider.ts`: parse/return usage envelopes and read project totals.
- Modify `src/features/studio/studio-store.ts`: accumulate draft usage, expose project usage, delete active drafts, and safely move to a prior stage.
- Create `src/features/studio/UsageSummary.vue`: format shared per-draft/project token and cost panels.
- Modify `src/features/studio/ProgressStepper.vue`, `src/features/studio/ResultEditor.vue`, `src/views/StudioView.vue`, `src/views/HomeView.vue`, and `src/app/styles.css`: expose step navigation, unfinished-draft deletion, and usage panels.
- Modify relevant unit, component, e2e, Cloudflare config, and README tests/documentation.

### Task 1: Usage Ledger Types, Pricing, and Migration

**Files:**
- Modify: `functions/lib/env.ts`
- Create: `functions/lib/usage.ts`
- Create: `migrations/0002_api_usage.sql`
- Modify: `tests/unit/auth-env-fixtures.ts`
- Create: `tests/unit/usage-ledger.test.ts`
- Modify: `tests/unit/cloudflare-deployment.test.ts`

**Interfaces:**
- Produces `OpenAIResponseUsage`, `UsageRecord`, and `UsageSummary`.
- Produces `parseOpenAIResponseUsage(payload)`, `estimateUsageKrw(usage, rates)`, `recordUsage(env, record)`, and `projectUsageSummary(env)`.
- Extends `ContentEnv` with `OPENAI_INPUT_KRW_PER_MILLION`, `OPENAI_CACHED_INPUT_KRW_PER_MILLION`, and `OPENAI_OUTPUT_KRW_PER_MILLION`.

- [x] **Step 1: Write failing usage-ledger tests**

Create `tests/unit/usage-ledger.test.ts` with a tracked fake D1 session and assert that exact OpenAI usage becomes one privacy-safe row and an integer estimate:

```ts
it("calculates one request estimate with cached input pricing", async () => {
  const usage = parseOpenAIResponseUsage({
    usage: { input_tokens: 1_000_000, output_tokens: 500_000, input_tokens_details: { cached_tokens: 200_000 } },
  })
  const estimate = estimateUsageKrw(usage, {
    inputKrwPerMillion: 1522.44,
    cachedInputKrwPerMillion: 152.244,
    outputKrwPerMillion: 9134.64,
  })

  expect(estimate).toBe(5_816)
})

it("records no content fields and summarizes project totals", async () => {
  const database = fakeUsageDatabase({ summary: { input_tokens: 13, cached_input_tokens: 2, output_tokens: 8, estimated_krw: 4, request_count: 2 } })
  await recordUsage(usageEnv(database), {
    draftId: "draft-1", requestKind: "naver", model: "gpt-5.6-luna",
    inputTokens: 10, cachedInputTokens: 2, outputTokens: 4, estimatedKrw: 2, createdAt: "2026-07-14T00:00:00.000Z",
  })

  expect(database.lastQuery).toContain("INSERT INTO api_usage")
  expect(database.lastBoundValues).toEqual(["draft-1", "naver", "gpt-5.6-luna", 10, 2, 4, 2, "2026-07-14T00:00:00.000Z"])
  await expect(projectUsageSummary(usageEnv(database))).resolves.toEqual({ inputTokens: 13, cachedInputTokens: 2, outputTokens: 8, totalTokens: 21, estimatedKrw: 4, requestCount: 2 })
})

it.each([
  [{ usage: { input_tokens: -1, output_tokens: 1 } }],
  [{ usage: { input_tokens: 1 } }],
  [{ usage: { input_tokens: 1, output_tokens: "1" } }],
])("rejects invalid upstream usage", (payload) => {
  expect(() => parseOpenAIResponseUsage(payload)).toThrow("AI 사용량 형식")
})
```

Add a deployment test expecting `0002_api_usage.sql` to contain the table and indexes, and expand the fake D1 statement with `bind`, `first`, and `run` observability.

- [x] **Step 2: Run the focused usage test to verify RED**

Run: `npm test -- --run tests/unit/usage-ledger.test.ts tests/unit/cloudflare-deployment.test.ts`

Expected: FAIL because the usage module, environment fields, fake database helpers, and migration do not exist.

- [x] **Step 3: Add the safe ledger implementation and migration**

Implement the exact values and checks:

```ts
export interface OpenAIResponseUsage {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
}

export function estimateUsageKrw(usage: OpenAIResponseUsage, rates: UsageRates): number {
  const uncachedInput = usage.inputTokens - usage.cachedInputTokens
  return Math.round((uncachedInput * rates.inputKrwPerMillion
    + usage.cachedInputTokens * rates.cachedInputKrwPerMillion
    + usage.outputTokens * rates.outputKrwPerMillion) / 1_000_000)
}
```

Require finite, non-negative integer token fields, cached input no larger than input, and finite non-negative price fields. Use a single parameterized `INSERT` with only the eight values asserted above. Make the aggregate query return zero totals when no rows exist.

Create `migrations/0002_api_usage.sql`:

```sql
CREATE TABLE IF NOT EXISTS api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id TEXT NOT NULL,
  request_kind TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  cached_input_tokens INTEGER NOT NULL CHECK (cached_input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  estimated_krw INTEGER NOT NULL CHECK (estimated_krw >= 0),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_usage_draft_id ON api_usage(draft_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_created_at ON api_usage(created_at);
```

- [x] **Step 4: Run the focused usage test to verify GREEN**

Run: `npm test -- --run tests/unit/usage-ledger.test.ts tests/unit/cloudflare-deployment.test.ts`

Expected: usage calculations, no-content ledger writes, aggregates, and migration checks pass.

- [x] **Step 5: Commit the ledger foundation**

```bash
git add functions/lib/env.ts functions/lib/usage.ts migrations/0002_api_usage.sql tests/unit/auth-env-fixtures.ts tests/unit/usage-ledger.test.ts tests/unit/cloudflare-deployment.test.ts
git commit -m "2026-07-14 OpenAI 사용량 원장 및 비용 기준 추가"
```

### Task 2: Return and Persist Actual Usage for AI Requests

**Files:**
- Modify: `functions/lib/openai-content.ts`
- Modify: `functions/lib/openai-image-analysis.ts`
- Modify: `functions/api/content/generate.ts`
- Modify: `functions/api/content/analyze-images.ts`
- Modify: `functions/api/content/rewrite.ts`
- Create: `functions/api/usage.ts`
- Modify: `src/domain/studio.ts`
- Modify: `src/domain/ports.ts`
- Modify: `src/adapters/openai-provider.ts`
- Modify: `src/adapters/local-ai-provider.ts`
- Test: `tests/unit/openai-content.test.ts`
- Test: `tests/unit/openai-image-analysis.test.ts`
- Test: `tests/unit/content-generation-function.test.ts`
- Test: `tests/unit/content-image-analysis-function.test.ts`
- Test: `tests/unit/content-rewrite-function.test.ts`
- Test: `tests/unit/openai-provider.test.ts`
- Create: `tests/unit/usage-function.test.ts`

**Interfaces:**
- Produces `AIResult<T> = { data: T; usage: UsageRecord | null }` for analysis, generation, and rewrite providers.
- Produces `DraftUsage` on `StudioDraft` with `inputTokens`, `cachedInputTokens`, `outputTokens`, `totalTokens`, `estimatedKrw`, and `requestCount`.
- Requires a bounded opaque `draftId` for every remote AI request and returns `{ source, data, usage }` for every successful remote content response.

- [x] **Step 1: Write failing server and provider tests**

Add request usage fixtures containing a completed Responses payload with:

```ts
usage: { input_tokens: 120, output_tokens: 80, input_tokens_details: { cached_tokens: 20 } }
```

Assert all three OpenAI helpers return both validated content and usage. Add one generate-handler test showing it requires `draftId`, records `requestKind: "naver"`, and returns:

```ts
{
  channel: "naver",
  source: "openai",
  data: validNaver(),
  usage: { inputTokens: 120, cachedInputTokens: 20, outputTokens: 80, totalTokens: 200, estimatedKrw: expect.any(Number), requestCount: 1 },
}
```

Add equivalent analysis/rewrite tests and `GET /api/usage` tests for aggregate output, malformed summary protection, and `405` on non-GET requests. Add provider tests proving a remote success returns the usage envelope while a 502 local fallback returns `{ data: localResult, usage: null }`.

- [x] **Step 2: Run the focused server/provider tests to verify RED**

Run: `npm test -- --run tests/unit/openai-content.test.ts tests/unit/openai-image-analysis.test.ts tests/unit/content-generation-function.test.ts tests/unit/content-image-analysis-function.test.ts tests/unit/content-rewrite-function.test.ts tests/unit/openai-provider.test.ts tests/unit/usage-function.test.ts`

Expected: FAIL because existing APIs return only content data and do not accept `draftId` or expose `/api/usage`.

- [x] **Step 3: Add usage envelopes and protected aggregate endpoint**

Refactor helper success returns to `{ data, responseUsage }`, preserving every validation before usage reaches a handler. In each handler, validate a non-empty bounded opaque `draftId` (the client uses UUIDs while existing tests use stable fixture IDs), compute the record with the configured rates, await `recordUsage`, and return the `usage` shape only after the ledger write succeeds.

Use these request kinds exactly: `image-analysis`, `naver`, `instagram`, `rewrite`, and `naver-title-body`. Do not record usage for a failed retry attempt that has no completed upstream response.

Add `isSameOriginRequest(request)` to `functions/lib/http.ts`; it compares the request Origin to `new URL(request.url).origin` without requiring a JSON content type. Then add `functions/api/usage.ts`:

```ts
export const onRequestGet: PagesHandler<ContentEnv> = async ({ request, env }) => {
  if (!isSameOriginRequest(request)) return json({ message: "요청을 확인해 주세요." }, 403)
  try { return json(await projectUsageSummary(env)) }
  catch { return json({ message: "AI 사용량을 불러오지 못했어요." }, 500) }
}
```

Adapt the provider parser to require exact `{ source, data, usage }` remote envelopes. Extend every AI input mapping with the store-supplied `draftId`. Keep `review` local and outside usage accounting.

- [x] **Step 4: Run focused tests to verify GREEN**

Run the Step 2 command again.

Expected: all updated helper, function, endpoint, and provider tests pass; existing local fallback assertions still pass.

- [x] **Step 5: Commit the remote usage path**

```bash
git add functions src/domain src/adapters tests/unit
git commit -m "2026-07-14 AI 요청 토큰 및 추정 비용 기록 추가"
```

### Task 3: Accumulate Usage, Delete Unfinished Drafts, and Navigate Backward

**Files:**
- Modify: `src/features/studio/studio-store.ts`
- Modify: `tests/helpers/in-memory-repository.ts`
- Modify: `tests/unit/studio-store.test.ts`
- Modify: `tests/unit/dexie-repository.test.ts`

**Interfaces:**
- Produces `store.projectUsage`, `store.loadUsageSummary()`, `store.deleteDraft(id)`, and `store.goToCompletedStep(target)`.
- Consumes `AIResult<T>` and `DraftUsage` from Task 2.

- [x] **Step 1: Write failing store and repository tests**

Add tests with independent fulfilled AI envelopes:

```ts
it("adds successful analysis, generation, and rewrite usage to its draft", async () => {
  // analyze: 100/20, naver: 40/30, instagram: 30/10, rewrite: 10/5
  await store.analyze()
  await store.generateAll()
  await store.rewrite({ channel: "naver", section: "intro", instruction: "감성 줄이기" })
  expect(store.draft?.usage).toMatchObject({ inputTokens: 180, outputTokens: 65, totalTokens: 245, requestCount: 4 })
})

it("does not add usage for a local fallback", async () => {
  // provider returns usage: null
  await store.generateAll()
  expect(store.draft?.usage.requestCount).toBe(0)
})

it("deletes one unfinished draft and leaves history untouched", async () => {
  await store.loadHome()
  await store.deleteDraft(active.id)
  expect(repository.drafts.has(active.id)).toBe(false)
  expect(repository.history.has(completed.id)).toBe(true)
})

it("moves only to a prior stable stage and persists it", async () => {
  store.draft = { ...readyDraft(), step: "results" }
  await store.goToCompletedStep("memo")
  expect(store.draft?.step).toBe("memo")
  await expect(store.goToCompletedStep("results")).rejects.toThrow("이전 단계")
  await expect(store.goToCompletedStep("generating")).rejects.toThrow("이동할 수 없어요")
})
```

Also add a Dexie round-trip test proving a legacy stored draft missing `usage` loads with zero totals and a saved draft retains an accumulated total.

- [x] **Step 2: Run store/repository tests to verify RED**

Run: `npm test -- --run tests/unit/studio-store.test.ts tests/unit/dexie-repository.test.ts`

Expected: FAIL because providers return raw data, no usage total exists, unfinished draft deletion is not exposed, and stage navigation is absent.

- [x] **Step 3: Add minimal store behavior**

Initialize every new draft with zero `DraftUsage`. Define one pure `addUsage` helper and invoke it only after each fulfilled AI result is validated. Keep usage inside the rewrite rollback snapshot so a failed review/persist restores both copy and usage. Treat absent usage on old drafts as the zero object during `load` and `loadHome`.

Implement:

```ts
async function deleteDraft(id: string) {
  await services.repository.deleteDraft(id)
  drafts.value = drafts.value.filter((item) => item.id !== id)
}

function goToCompletedStep(target: WorkflowStep) {
  return enqueueResultMutation(async () => {
    if (!draft.value || busy.value || !canGoToPriorStep(draft.value.step, target)) {
      throw new Error("완료한 이전 단계로만 이동할 수 있어요.")
    }
    draft.value.step = target
    draft.value.updatedAt = new Date().toISOString()
    await persistNow()
  })
}
```

Make `canGoToPriorStep` use the stable order `photos`, `organize`, `memo`, `brief`, `results` and explicitly reject `generating`.

- [x] **Step 4: Run store/repository tests to verify GREEN**

Run the Step 2 command again.

Expected: usage accumulation, zero fallback usage, safe draft deletion, stage boundary checks, and Dexie compatibility pass.

- [x] **Step 5: Commit client state behavior**

```bash
git add src/domain/studio.ts src/features/studio/studio-store.ts tests/helpers/in-memory-repository.ts tests/unit/studio-store.test.ts tests/unit/dexie-repository.test.ts
git commit -m "2026-07-14 초안 삭제 단계 이동 및 글별 사용량 저장"
```

### Task 4: Show Usage, Expose Controls, and Verify the Full User Flow

**Files:**
- Create: `src/features/studio/UsageSummary.vue`
- Modify: `src/features/studio/ProgressStepper.vue`
- Modify: `src/features/studio/ResultEditor.vue`
- Modify: `src/views/StudioView.vue`
- Modify: `src/views/HomeView.vue`
- Modify: `src/app/styles.css`
- Modify: `tests/component/history-deletion.test.ts`
- Modify: `tests/component/studio-photo-flow.test.ts`
- Modify: `tests/component/results.test.ts`
- Create: `tests/component/usage-summary.test.ts`
- Modify: `tests/e2e/studio-flow.spec.ts`

**Interfaces:**
- `UsageSummary` accepts `usage: DraftUsage`, `scope: "draft" | "project"`, and renders accessible Korean totals.
- `ProgressStepper` emits `navigate` only for a completed stable step.

- [x] **Step 1: Write failing component and browser tests**

Add component assertions for:

```ts
expect(screen.getByRole("heading", { name: "프로젝트 AI 사용량" })).toBeTruthy()
expect(screen.getByText("총 245 토큰")).toBeTruthy()
expect(screen.getByText("추정 비용 123원")).toBeTruthy()

await fireEvent.click(screen.getByRole("button", { name: "작성 중인 글 삭제" }))
expect(screen.getByRole("alertdialog").textContent).toContain("작성 중인 글과 사진을 영구 삭제")
await fireEvent.click(screen.getByRole("button", { name: "삭제" }))
expect(screen.queryByText("작성 중인 글")).toBeNull()

await fireEvent.click(screen.getByRole("button", { name: "3단계 메모로 이동" }))
await waitFor(() => expect(screen.getByLabel("오늘의 수련 메모")).toBeTruthy())
expect(screen.getByRole("button", { name: "5단계 생성으로 이동" })).toBeDisabled()
```

Extend Playwright to seed a completed record and active draft, confirm only the active draft disappears, and verify that a stored usage fixture is visible in both HomeView and ResultEditor. Verify a numbered prior stage changes the rendered panel and a future number remains disabled.

- [x] **Step 2: Run component/browser tests to verify RED**

Run: `npm test -- --run tests/component/history-deletion.test.ts tests/component/studio-photo-flow.test.ts tests/component/results.test.ts tests/component/usage-summary.test.ts && npx playwright test tests/e2e/studio-flow.spec.ts --reporter=line`

Expected: FAIL because no unfinished-draft delete control, usage panel, or interactive completed-stage buttons exist.

- [x] **Step 3: Implement the UI with accessible semantics**

Render each unfinished draft as the existing actionable row plus a sibling delete button. Reuse `HistoryDeleteDialog` with target kind `draft`, title `작성 중인 글 삭제`, and description `“${title}” 작성 중인 글과 사진을 영구 삭제할까요?`.

Make `ProgressStepper` render a button for `complete` stages with exact aria-label `${index + 1}단계 ${step.label}로 이동`, `cursor: pointer`, and an emitted `navigate` event. Render the current/upcoming/generating entries as non-actionable spans, preserving `aria-current="step"` for the current state.

Build `UsageSummary` with `Intl.NumberFormat("ko-KR")`, headings `이번 글 AI 사용량` and `프로젝트 AI 사용량`, `총 N 토큰`, input/output breakdown, request count, and `추정 비용 N원`. HomeView calls `store.loadUsageSummary()` after drafts/history and shows an unavailable note on summary failure without blocking the page.

- [x] **Step 4: Run component/browser tests to verify GREEN**

Run the Step 2 command again.

Expected: the controls are keyboard-accessible, deletion confirms and isolates data, only completed prior steps navigate, and both cost panels show formatted values.

- [x] **Step 5: Commit the visible workflow controls**

```bash
git add src/features/studio/UsageSummary.vue src/features/studio/ProgressStepper.vue src/features/studio/ResultEditor.vue src/views/StudioView.vue src/views/HomeView.vue src/app/styles.css tests/component tests/e2e/studio-flow.spec.ts
git commit -m "2026-07-14 초안 삭제 단계 이동 및 사용량 화면 추가"
```

### Task 5: Configuration, Verification, Merge, and Deployment

**Files:**
- Modify: `README.md`
- Modify: `tests/unit/cloudflare-deployment.test.ts`
- Modify: `docs/superpowers/plans/2026-07-14-draft-controls-and-usage-accounting.md`

- [x] **Step 1: Write the failing deployment documentation test**

Extend `tests/unit/cloudflare-deployment.test.ts` to require the README to document these commands without including credentials:

```text
npx wrangler d1 migrations apply ap-yoga-auth --remote
npx wrangler pages secret put OPENAI_INPUT_KRW_PER_MILLION --project-name ap-yoga-content-studio
npx wrangler pages secret put OPENAI_CACHED_INPUT_KRW_PER_MILLION --project-name ap-yoga-content-studio
npx wrangler pages secret put OPENAI_OUTPUT_KRW_PER_MILLION --project-name ap-yoga-content-studio
```

- [x] **Step 2: Run the documentation test to verify RED**

Run: `npm test -- --run tests/unit/cloudflare-deployment.test.ts`

Expected: FAIL because usage migration and pricing configuration instructions are missing.

- [x] **Step 3: Document configuration and verify GREEN**

Add a privacy-safe README section explaining that current model prices are converted to KRW by the administrator, the three rate variables are estimates, and changing rates affects future rows only. Document the D1 migration-before-deploy order.

Run: `npm test -- --run tests/unit/cloudflare-deployment.test.ts`

Expected: PASS.

- [x] **Step 4: Run complete verification**

Run:

```bash
npm run typecheck
npm run typecheck:functions
npm run test:run
npm run build
npm run test:e2e
git diff --check
```

Expected: both type checks, all Vitest tests, production build, all browser tests, and whitespace validation pass.

- [x] **Step 5: Commit documentation and push the feature branch**

```bash
git add README.md tests/unit/cloudflare-deployment.test.ts docs/superpowers/plans/2026-07-14-draft-controls-and-usage-accounting.md
git commit -m "2026-07-14 사용량 비용 설정 및 배포 안내 추가"
git push origin codex/photo-aware-generation
```

- [ ] **Step 6: Apply production configuration and migration**

Use the exact current administrator-approved values, without printing credentials. Apply the D1 migration before deployment:

```bash
npx wrangler d1 migrations apply ap-yoga-auth --remote
npx wrangler pages secret put OPENAI_INPUT_KRW_PER_MILLION --project-name ap-yoga-content-studio
npx wrangler pages secret put OPENAI_CACHED_INPUT_KRW_PER_MILLION --project-name ap-yoga-content-studio
npx wrangler pages secret put OPENAI_OUTPUT_KRW_PER_MILLION --project-name ap-yoga-content-studio
```

Expected: the migration creates `api_usage`; all three rate values are set as Pages secrets.

- [ ] **Step 7: Merge and deploy**

```bash
git -C /Users/taejun-yun/Documents/Codex/blog checkout master
git -C /Users/taejun-yun/Documents/Codex/blog pull --ff-only origin master
git -C /Users/taejun-yun/Documents/Codex/blog merge --no-ff codex/photo-aware-generation -m "2026-07-14 초안 관리 및 AI 사용량 비용 표시 병합"
git -C /Users/taejun-yun/Documents/Codex/blog push origin master
git -C /Users/taejun-yun/Documents/Codex/blog worktree list
npm run deploy:cloudflare
```

Expected: master contains the feature commit, Pages reports a new deployment URL, and the production alias serves the new usage and draft-control labels.

- [ ] **Step 8: Verify production and record evidence**

Open the new Pages URL and verify the login page responds. With the authenticated test session, verify one new generation records project usage, the result shows per-draft usage, an unfinished draft can be deleted after confirmation, and a completed prior step can be reopened. Append timestamp, deployment URL, applied migration, rate-source date, verification outputs, and remaining live-check limitation (if credentials are not entered by automation) to this plan, then commit and push the evidence.
