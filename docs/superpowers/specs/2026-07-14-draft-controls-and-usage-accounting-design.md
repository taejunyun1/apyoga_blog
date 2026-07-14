# Draft Controls and Usage Accounting Design

## Goal

Let an operator delete unfinished drafts safely, revisit completed workflow stages through the numbered progress controls, and see OpenAI token usage plus estimated KRW cost for each draft and the overall project.

## Decisions

- Unfinished drafts are deleted from the home screen only after an explicit confirmation. The draft record and its edited image blobs are permanently removed from IndexedDB.
- Completed-history deletion keeps its existing behavior. Project-level API usage is never deleted with either history or unfinished drafts.
- The progress stepper makes only already-completed, non-generating steps interactive. The current step remains announced as the current step; future steps and the generating state are disabled.
- Selecting an earlier step changes only the active workflow step, updates `updatedAt`, and persists the draft before rendering that screen. It does not discard the brief, generated copy, review, or image ordering already stored in the draft.
- The server calculates usage from successful OpenAI Responses API payloads. It records only draft ID, request kind, model, input tokens, output tokens, estimated KRW, and timestamp—never prompts, generated copy, image data, or API credentials.
- Input and output unit prices are configured as Cloudflare environment variables in KRW per one million tokens. The UI calls all cost figures `추정 비용`.
- Each successful image analysis, channel generation, single-section rewrite, and paired Naver title/body rewrite produces one usage record. Local fallbacks produce no OpenAI usage record and are labeled as local in the draft flow.
- Per-draft usage is returned with the content response and stored on the `StudioDraft`; a protected usage summary endpoint returns the project-wide D1 totals. This preserves the per-draft total after the browser reloads while keeping the project total when drafts are deleted or browser storage is cleared.

## Architecture

### Server usage ledger

`functions/lib/env.ts` gains typed D1 and price configuration support. A new `api_usage` table is created through a D1 migration in the existing `ap-yoga-auth` database. The table uses `draft_id` and `created_at` indexes for summaries and contains no content fields.

The three OpenAI request helpers parse the Responses API `usage` object after validating the content result. They return a data-and-usage envelope. Content endpoints validate a `draftId` field, calculate the request estimate using configured rates, insert the ledger row only after OpenAI returns a completed response, and send the request usage in their success envelope.

`GET /api/usage` returns the current project aggregate: input tokens, output tokens, total tokens, estimated KRW, and request count. The existing authentication middleware protects it.

### Client data flow

The AI provider returns an explicit envelope for analysis, content generation, and rewrite operations. The studio store merges each returned usage record into `draft.usage`, then persists the draft alongside the normal content update. A separate provider method requests the project usage summary when HomeView loads.

The result editor shows a compact `이번 글 AI 사용량` panel containing total tokens, input/output breakdown, request count, and estimated KRW. HomeView shows `프로젝트 AI 사용량` with the same totals and a note that it includes deleted drafts and uses configured unit prices.

### Draft deletion and stage navigation

HomeView reuses `HistoryDeleteDialog` with a new unfinished-draft target. Each draft row gets an independently accessible delete button. Confirmation invokes the existing repository `deleteDraft`, removes the row only after success, and shows a toast; a failure retains the row and exposes the dialog error.

`ProgressStepper` emits a requested workflow step. StudioView delegates to a store `goToCompletedStep` method. The store rejects a target later than the current stable stage, rejects `generating`, and serializes the state update through the current persistence queue. Buttons are native buttons with pointer cursor for reachable stages and disabled semantics for others.

## Error Handling and Safety

- Missing price variables or missing D1 usage storage produce a generic server error for the affected content request; no request is marked as used unless the OpenAI response and ledger insert both succeed.
- Invalid/missing token values are treated as an upstream retryable response error rather than recorded as zero.
- A failed usage-summary request does not block drafts/history from loading; HomeView displays an unavailable state and retains a retryable fetch on the next load.
- Deleting an unfinished draft never changes history, usage records, or another draft. The confirmation dialog defaults focus to Cancel.
- A stage transition is blocked while the store is busy or a result mutation is queued.

## Testing

- Unit tests cover usage parsing, cost calculation, missing/invalid usage rejection, and D1 ledger inserts/summaries.
- Provider/store tests cover per-draft accumulation, local fallback zero usage, summary failure isolation, unfinished-draft deletion, and stage-transition boundaries.
- Component tests cover the confirmation dialog, result/home usage display, accessible disabled/current stepper controls, and successful prior-step navigation.
- Playwright covers deleting an unfinished draft without deleting a completed entry, visible project and draft usage, and navigating backward through the numbered stepper.

## Deployment

Before deployment, apply the D1 migration to the existing remote `ap-yoga-auth` database and set the two KRW-per-million-token environment values through Cloudflare. Build, unit tests, browser tests, and a protected live smoke check are required before merging to `master` and deploying Pages.
