# OpenAI Content Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate independent Naver and Instagram drafts through authenticated Cloudflare Pages Functions backed by the OpenAI Responses API, while guaranteeing a 500-character Naver body and falling back locally per channel.

**Architecture:** The browser uses an `OpenAIProvider` that sends one same-origin request per channel to `/api/content/generate`; the Pages Function calls `gpt-5.6-luna` with strict Structured Outputs and never exposes `OPENAI_API_KEY`. Retryable upstream failures receive one server retry, then the browser falls back to `LocalAIProvider` for that channel and marks the result as a local fallback.

**Tech Stack:** Vue 3, Pinia, TypeScript, Vitest, Cloudflare Pages Functions, Wrangler, OpenAI Responses API, strict JSON Schema.

## Global Constraints

- Naver `body.trim().length` must be at least 500; title, intro, hashtags, and class information do not count.
- Instagram has no 500-character minimum and retains distinct long and short captions.
- Naver and Instagram requests remain independent so `Promise.allSettled` preserves partial success.
- Photo binaries, email addresses, API keys, browser storage, and edited images never leave the browser.
- `OPENAI_API_KEY` exists only as a Cloudflare production secret and must never appear in Git, command arguments, browser bundles, responses, or logs.
- OpenAI requests use `gpt-5.6-luna`, `store: false`, low reasoning effort, a hashed safety identifier, and strict `text.format` JSON Schema.
- Retry network errors, 429, 5xx, invalid structured output, and short Naver output once; do not retry OpenAI auth or other non-retryable 4xx errors.
- Browser API responses with 401 or 403 are authentication failures: never fall back locally; propagate them so the app can return to login. Local fallback is allowed only for content-service failure responses such as 502.
- All content API responses use `Cache-Control: no-store` and require the existing authenticated same-origin JSON flow.
- Existing edit, rewrite, copy, IndexedDB persistence, and channel-specific error behavior remain intact.

---

### Task 1: Guarantee a 500-character local Naver fallback

**Files:**
- Modify: `src/adapters/local-ai-provider.ts`
- Modify: `tests/unit/local-ai-provider.test.ts`

**Interfaces:**
- Consumes: existing `LocalAIProvider.generateNaver(input: ChannelInput): Promise<NaverOutput>`.
- Produces: a local `NaverOutput` whose `body.trim().length >= 500` after forbidden expressions are removed.

- [ ] **Step 1: Write the failing length and forbidden-expression tests**

Add assertions to `tests/unit/local-ai-provider.test.ts`:

```ts
it("keeps the local Naver fallback at 500 characters after filtering", async () => {
  const provider = new LocalAIProvider()
  const brief = await provider.analyzeImages({
    ...analyzeInput,
    memo: "짧은 수련 메모 치료",
    avoid: "치료,과장"
  })
  const naver = await provider.generateNaver({
    ...analyzeInput,
    memo: "짧은 수련 메모 치료",
    avoid: "치료,과장",
    brief
  })

  expect(naver.body.trim().length).toBeGreaterThanOrEqual(500)
  expect(naver.body).not.toContain("치료")
  expect(naver.body).not.toContain("과장")
})
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `npm run test:run -- tests/unit/local-ai-provider.test.ts`

Expected: FAIL because the current three-paragraph Naver body is shorter than 500 characters.

- [ ] **Step 3: Implement structured local paragraphs and a final invariant**

In `src/adapters/local-ai-provider.ts`, add a focused helper and use it from `generateNaver`:

```ts
const NAVER_MIN_LENGTH = 500

function naverBody(input: ChannelInput, focus: string, required: string): string {
  const memo = withoutAvoided(input.memo, input.avoid) || "오늘의 수련을 차분히 돌아보았습니다."
  const paragraphs = [
    `오늘은 ${focus}에 천천히 주의를 기울이며 수련을 시작했습니다. ${required}을 따라 서두르지 않고 몸과 마음이 현재에 도착할 시간을 충분히 두었습니다.`,
    `${memo}라는 기록을 바탕으로 각 동작의 크기보다 움직임이 이어지는 과정과 그 사이의 여백을 살펴보았습니다.`,
    `숨을 들이쉴 때와 내쉴 때 달라지는 감각을 관찰하며 ${focus} 주변의 긴장을 억지로 밀어내지 않고 각자의 편안한 범위 안에서 움직였습니다.`,
    `사진에 담긴 장면마다 완성된 모양보다 집중하는 표정과 안정된 리듬이 먼저 보였습니다. 서로의 속도를 존중하니 수련 공간도 한결 차분해졌습니다.`,
    `수련이 깊어질수록 큰 변화보다 작고 분명한 신호를 알아차리는 일이 중요하다는 것을 다시 확인했습니다. 잠시 쉬는 선택도 오늘의 몸에 맞는 좋은 움직임이 될 수 있습니다.`,
    `마무리에서는 처음과 달라진 호흡과 바닥에 닿는 감각을 천천히 확인했습니다. 일상으로 돌아간 뒤에도 오늘 발견한 편안한 리듬을 짧게 떠올려 보세요.`
  ]
  const safe = withoutAvoided(paragraphs.join("\n\n"), input.avoid)
  if (safe.trim().length >= NAVER_MIN_LENGTH) return safe
  return `${safe}\n\n${withoutAvoided(`A.P YOGA는 정답처럼 보이는 자세보다 자신의 ${focus} 감각을 세심하게 알아차리는 과정을 소중히 여깁니다. 다음 수련에서도 ${required}으로 돌아오며 오늘의 경험을 차분히 이어가겠습니다.`, input.avoid)}`
}
```

Replace the existing inline `body` array with `const body = naverBody(input, focus, required)`. Keep `qualityChecks` based on the final body.

- [ ] **Step 4: Run targeted and domain tests for GREEN**

Run: `npm run test:run -- tests/unit/local-ai-provider.test.ts tests/unit/domain-rules.test.ts`

Expected: PASS, including the new minimum-length test.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/adapters/local-ai-provider.ts tests/unit/local-ai-provider.test.ts
git commit -m "2026-07-12 네이버 로컬 본문 500자 보장"
```

---

### Task 2: Build the OpenAI Responses client and strict channel schemas

**Files:**
- Create: `functions/lib/content-types.ts`
- Create: `functions/lib/openai-content.ts`
- Create: `tests/unit/openai-content.test.ts`
- Modify: `functions/lib/env.ts`

**Interfaces:**
- Consumes: `ContentEnv.OPENAI_API_KEY`, channel request DTOs, an injectable `fetcher`.
- Produces: `requestOpenAIContent(channel, input, env, options): Promise<GeneratedContent>` and `validateGeneratedContent(channel, value): GeneratedContent`.

- [ ] **Step 1: Write failing OpenAI request-shape and validation tests**

Create `tests/unit/openai-content.test.ts` with an injectable fetch fake:

```ts
import { describe, expect, it, vi } from "vitest"
import { requestOpenAIContent } from "../../functions/lib/openai-content"

const request = {
  memo: "어깨와 흉곽을 천천히 연 수련",
  mustInclude: "호흡",
  avoid: "치료",
  writingMode: "body-sense",
  tone: "plain",
  brief: {
    classSummary: "차분한 저녁 수련",
    overallMood: "차분함",
    bodyFocus: ["어깨", "흉곽"],
    imageDescriptions: [{ imageId: "image-1", description: "첫 번째 수련 장면" }],
    recommendedCoverImageId: "image-1",
    recommendedImageOrder: ["image-1"]
  }
}

it("sends a stateless strict Responses request without photo data", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(validNaver()) }] }]
  }))

  await requestOpenAIContent("naver", request, { OPENAI_API_KEY: "test-key" }, { fetcher, safetyIdentifier: "hashed-user" })

  const init = fetcher.mock.calls[0][1] as RequestInit
  const body = JSON.parse(String(init.body))
  expect(body.model).toBe("gpt-5.6-luna")
  expect(body.store).toBe(false)
  expect(body.reasoning).toEqual({ effort: "low" })
  expect(body.safety_identifier).toBe("hashed-user")
  expect(body.text.format.type).toBe("json_schema")
  expect(body.text.format.strict).toBe(true)
  expect(String(init.body)).not.toContain("blob:")
  expect(init.headers).toMatchObject({ Authorization: "Bearer test-key" })
})

it("rejects a Naver body shorter than 500 characters", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ ...validNaver(), body: "짧은 본문" }) }] }]
  }))

  await expect(requestOpenAIContent("naver", request, { OPENAI_API_KEY: "test-key" }, { fetcher, safetyIdentifier: "hashed-user" }))
    .rejects.toThrow("네이버 본문은 500자 이상이어야 해요.")
})
```

Define `validNaver()` in the test with exactly three titles, three intros, a 500+ character body, image placements, hashtags, and class info. Add matching Instagram validation for three hooks and distinct captions.

- [ ] **Step 2: Run the new test and verify RED**

Run: `npm run test:run -- tests/unit/openai-content.test.ts`

Expected: FAIL because `functions/lib/openai-content.ts` does not exist.

- [ ] **Step 3: Define focused DTOs and the content environment**

Create `functions/lib/content-types.ts` with server-only DTOs:

```ts
export type ContentChannel = "naver" | "instagram"

export interface GenerateContentInput {
  memo: string
  mustInclude: string
  avoid: string
  writingMode: "auto" | "record" | "essay" | "philosophy" | "body-sense" | "space" | "daily"
  tone: "plain" | "emotional" | "deep"
  brief: {
    classSummary: string
    overallMood: string
    bodyFocus: string[]
    imageDescriptions: Array<{ imageId: string; description: string }>
    recommendedCoverImageId: string
    recommendedImageOrder: string[]
  }
}

export interface GeneratedNaver {
  titles: string[]
  introOptions: string[]
  body: string
  imagePlacements: Array<{ imageId: string; afterParagraph: number; caption: string }>
  hashtags: string[]
  classInfo: string
}

export interface GeneratedInstagram {
  hookOptions: string[]
  captionLong: string
  captionShort: string
  hashtags: string[]
  coverImageId: string
  imageOrder: string[]
}

export type GeneratedContent = GeneratedNaver | GeneratedInstagram
```

Extend `functions/lib/env.ts`:

```ts
export interface ContentEnv extends AuthEnv {
  OPENAI_API_KEY: string
}
```

- [ ] **Step 4: Implement the raw Responses client and validation**

Create `functions/lib/openai-content.ts` with these boundaries:

```ts
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
const MODEL = "gpt-5.6-luna"

export class OpenAIContentError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message)
  }
}

export async function requestOpenAIContent(
  channel: ContentChannel,
  input: GenerateContentInput,
  env: Pick<ContentEnv, "OPENAI_API_KEY">,
  options: { fetcher?: typeof fetch; safetyIdentifier: string; retryInstruction?: string }
): Promise<GeneratedContent> {
  const response = await (options.fetcher ?? fetch)(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      store: false,
      reasoning: { effort: "low" },
      safety_identifier: options.safetyIdentifier,
      instructions: promptFor(channel, options.retryInstruction),
      input: JSON.stringify(input),
      text: { format: schemaFor(channel) }
    })
  })
  if (!response.ok) throw new OpenAIContentError("AI 생성 요청에 실패했어요.", response.status === 429 || response.status >= 500)
  const payload = await response.json() as OpenAIResponse
  if (payload.status !== "completed") throw new OpenAIContentError("AI 생성이 완료되지 않았어요.", true)
  const text = outputText(payload)
  return validateGeneratedContent(channel, JSON.parse(text), input)
}
```

Implement `promptFor`, `schemaFor`, `outputText`, and `validateGeneratedContent(channel, value, input)` in the same file. The Naver schema uses `minLength: 500`; all object schemas use `additionalProperties: false`, all keys are required, and the application validator checks array counts, string types, required phrase inclusion, forbidden phrases, and `body.trim().length >= 500` against the original input.

- [ ] **Step 5: Run OpenAI client tests and Functions typecheck**

Run: `npm run test:run -- tests/unit/openai-content.test.ts && npm run typecheck:functions`

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add functions/lib/content-types.ts functions/lib/openai-content.ts functions/lib/env.ts tests/unit/openai-content.test.ts
git commit -m "2026-07-12 OpenAI 구조화 콘텐츠 클라이언트"
```

---

### Task 3: Add the authenticated generation endpoint with bounded retry

**Files:**
- Create: `functions/api/content/generate.ts`
- Create: `tests/unit/content-generation-function.test.ts`
- Modify: `tests/unit/auth-middleware.test.ts`

**Interfaces:**
- Consumes: `requestOpenAIContent`, `ContentEnv`, same-origin JSON requests.
- Produces: `handleContentGeneration(request, env, dependencies): Promise<Response>` and Pages `onRequestPost`.

- [ ] **Step 1: Write failing endpoint validation and retry tests**

Create `tests/unit/content-generation-function.test.ts`:

```ts
it("rejects cross-origin and oversized content requests", async () => {
  const crossOrigin = requestFor("naver", validInput(), { Origin: "https://attacker.example" })
  expect((await handleContentGeneration(crossOrigin, env, dependencies)).status).toBe(403)

  const oversized = requestFor("naver", validInput(), { "Content-Length": "32769" })
  expect((await handleContentGeneration(oversized, env, dependencies)).status).toBe(413)
})

it("retries a short Naver result once and returns the second result", async () => {
  const generate = vi.fn()
    .mockRejectedValueOnce(new OpenAIContentError("네이버 본문은 500자 이상이어야 해요.", true))
    .mockResolvedValueOnce(validNaver())

  const response = await handleContentGeneration(requestFor("naver", validInput()), env, { generate, safetyIdentifier })
  expect(response.status).toBe(200)
  expect(generate).toHaveBeenCalledTimes(2)
  expect(await response.json()).toMatchObject({ channel: "naver", source: "openai" })
})

it("does not retry an OpenAI authentication error", async () => {
  const generate = vi.fn().mockRejectedValue(new OpenAIContentError("AI 설정을 확인해 주세요.", false))
  const response = await handleContentGeneration(requestFor("instagram", validInput()), env, { generate, safetyIdentifier })
  expect(response.status).toBe(502)
  expect(generate).toHaveBeenCalledTimes(1)
})
```

Add a middleware assertion that `/api/content/generate` returns 401 without a valid session.

- [ ] **Step 2: Run endpoint tests and verify RED**

Run: `npm run test:run -- tests/unit/content-generation-function.test.ts tests/unit/auth-middleware.test.ts`

Expected: FAIL because the endpoint module is missing.

- [ ] **Step 3: Implement request parsing, hashing, retry, and no-store responses**

Create `functions/api/content/generate.ts`:

```ts
const MAX_BODY_BYTES = 32_768

export async function handleContentGeneration(
  request: Request,
  env: ContentEnv,
  dependencies = {
    generate: requestOpenAIContent,
    safetyIdentifier: () => hashedSafetyIdentifier(env.AUTH_USERNAME)
  }
): Promise<Response> {
  if (!isSameOriginJson(request)) return json({ message: "요청을 확인해 주세요." }, 403)
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY_BYTES) return json({ message: "입력 내용이 너무 길어요." }, 413)
  if (!env.OPENAI_API_KEY) return json({ message: "AI 설정을 확인해 주세요." }, 500)
  const raw = await request.text()
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json({ message: "입력 내용이 너무 길어요." }, 413)
  const parsed = validateContentRequest(JSON.parse(raw))

  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const data = await dependencies.generate(parsed.channel, parsed.input, env, {
        safetyIdentifier: await dependencies.safetyIdentifier(),
        retryInstruction: attempt === 1 ? "이전 결과의 오류를 수정하고 모든 제약을 충족하세요." : undefined
      })
      return json({ channel: parsed.channel, source: "openai", data })
    } catch (error) {
      lastError = error
      if (!(error instanceof OpenAIContentError) || !error.retryable) break
    }
  }
  return json({ message: "AI 생성이 지연되어 로컬 초안으로 전환합니다." }, 502)
}
```

Implement `validateContentRequest` with allowed channels, string length limits (`memo <= 4_000`, `mustInclude <= 500`, `avoid <= 500`), arrays capped at 10 images/body focuses, and no unknown photo binary fields. Hash the configured account with `crypto.subtle.digest("SHA-256", ...)` and encode only the first 32 hex characters.

- [ ] **Step 4: Run endpoint, middleware, and auth tests for GREEN**

Run: `npm run test:run -- tests/unit/content-generation-function.test.ts tests/unit/auth-middleware.test.ts tests/unit/auth-functions.test.ts && npm run typecheck:functions`

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add functions/api/content/generate.ts tests/unit/content-generation-function.test.ts tests/unit/auth-middleware.test.ts
git commit -m "2026-07-12 인증 콘텐츠 생성 API"
```

---

### Task 4: Route browser generation through OpenAI with per-channel local fallback

**Files:**
- Create: `src/adapters/openai-provider.ts`
- Create: `tests/unit/openai-provider.test.ts`
- Modify: `src/features/studio/studio-store.ts`
- Modify: `src/domain/studio.ts`
- Modify: `tests/unit/studio-store.test.ts`

**Interfaces:**
- Consumes: `ChannelInput`, `/api/content/generate`, `LocalAIProvider`.
- Produces: `OpenAIProvider implements AIProvider`; channel outputs carry `generationSource: "openai" | "local-fallback"`.

- [ ] **Step 1: Write failing remote-provider tests**

Create `tests/unit/openai-provider.test.ts`:

```ts
it("requests each channel without image binaries", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ channel: "naver", source: "openai", data: validNaver() }))
  const provider = new OpenAIProvider({ fetcher, local: new LocalAIProvider() })
  const result = await provider.generateNaver(channelInput)

  expect(result.generationSource).toBe("openai")
  const body = JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body))
  expect(body.channel).toBe("naver")
  expect(body.input.images).toBeUndefined()
  expect(JSON.stringify(body)).not.toContain("blob:")
})

it("falls back locally for only the failed channel", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 502 }))
  const provider = new OpenAIProvider({ fetcher, local: new LocalAIProvider() })
  const result = await provider.generateNaver(channelInput)

  expect(result.generationSource).toBe("local-fallback")
  expect(result.body.trim().length).toBeGreaterThanOrEqual(500)
})
```

Add a store test that configures `OpenAIProvider`, lets Naver fall back while Instagram succeeds remotely, and confirms both channel states are `success` with different `generationSource` values.

- [ ] **Step 2: Run provider and store tests and verify RED**

Run: `npm run test:run -- tests/unit/openai-provider.test.ts tests/unit/studio-store.test.ts`

Expected: FAIL because `OpenAIProvider` and `generationSource` do not exist.

- [ ] **Step 3: Add the generation source type**

In `src/domain/studio.ts`, add:

```ts
export type GenerationSource = "openai" | "local-fallback"
```

Add `generationSource: GenerationSource` to both `NaverOutput` and `InstagramOutput`. Update `LocalAIProvider` to return `local-fallback`; remote successful responses overwrite it with `openai`.

- [ ] **Step 4: Implement `OpenAIProvider` and preserve local-only analysis/review/rewrite**

Create `src/adapters/openai-provider.ts`:

```ts
type RemoteNaver = Omit<NaverOutput, "generationSource" | "qualityChecks">
type RemoteInstagram = Omit<InstagramOutput, "generationSource" | "qualityChecks">

export class OpenAIProvider implements AIProvider {
  constructor(private readonly options: { fetcher?: typeof fetch; local?: LocalAIProvider } = {}) {}

  private get local() { return this.options.local ?? new LocalAIProvider() }

  analyzeImages(input: AnalyzeImagesInput) { return this.local.analyzeImages(input) }
  rewriteSection(input: RewriteInput) { return this.local.rewriteSection(input) }
  review(input: { text: string; maskedFacesConfirmed: boolean }) { return this.local.review(input) }

  generateNaver(input: ChannelInput) {
    return this.generate("naver", input, () => this.local.generateNaver(input)) as Promise<NaverOutput>
  }

  generateInstagram(input: ChannelInput) {
    return this.generate("instagram", input, () => this.local.generateInstagram(input)) as Promise<InstagramOutput>
  }

  private async generate(channel: Channel, input: ChannelInput, fallback: () => Promise<NaverOutput | InstagramOutput>) {
    const response = await (this.options.fetcher ?? fetch)("/api/content/generate", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, input: toContentInput(channel, input) })
    })
    if (response.status === 401 || response.status === 403) throw new Error("로그인이 필요해요.")
    if (!response.ok) return { ...(await fallback()), generationSource: "local-fallback" as const }
    const payload = await response.json() as { data: RemoteNaver | RemoteInstagram }
    if (channel === "naver") {
      const data = payload.data as RemoteNaver
      return {
        ...data,
        generationSource: "openai" as const,
        qualityChecks: {
          avoidedExpressionRemoved: !forbiddenExpressions(input.avoid).some((term) => data.body.includes(term)),
          includesRequiredPhrase: !input.mustInclude.trim() || data.body.includes(input.mustInclude.trim())
        }
      }
    }
    const data = payload.data as RemoteInstagram
    return {
      ...data,
      generationSource: "openai" as const,
      qualityChecks: {
        distinctFromNaver: true,
        avoidedExpressionRemoved: !forbiddenExpressions(input.avoid).some((term) => data.captionLong.includes(term))
      }
    }
  }
}
```

`toContentInput` sends memo, must/avoid, writing mode, channel tone, and only the brief fields approved by the spec. It must not include `images`, thumbnail URLs, blob IDs, hashes, masks, or the login identifier.

- [ ] **Step 5: Configure `OpenAIProvider` as the default studio AI service**

In `src/features/studio/studio-store.ts`, replace `ai: new LocalAIProvider()` with `ai: new OpenAIProvider()`. Keep `LocalAIProvider` only inside the remote provider fallback.

- [ ] **Step 6: Run provider, store, and existing generation tests for GREEN**

Run: `npm run test:run -- tests/unit/openai-provider.test.ts tests/unit/studio-store.test.ts tests/component/studio-generation-flow.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/adapters/openai-provider.ts src/features/studio/studio-store.ts src/domain/studio.ts src/adapters/local-ai-provider.ts tests/unit/openai-provider.test.ts tests/unit/studio-store.test.ts
git commit -m "2026-07-12 채널별 GPT 생성과 로컬 대체"
```

---

### Task 5: Show local-fallback status without blocking editing

**Files:**
- Modify: `src/features/studio/ResultEditor.vue`
- Modify: `tests/component/results.test.ts`
- Modify: `tests/fixtures.ts`

**Interfaces:**
- Consumes: `generationSource` on successful Naver and Instagram outputs.
- Produces: a channel-local status message while all edit, rewrite, retry, and copy controls remain enabled.

- [ ] **Step 1: Write the failing fallback-notice component test**

Add to `tests/component/results.test.ts`:

```ts
it("explains a local fallback without hiding the generated result", () => {
  render(ResultEditor, {
    props: {
      naver: { status: "success", error: null, data: { ...naver, generationSource: "local-fallback" } },
      instagram: failedInstagram,
      review,
      copyFallback: null
    }
  })

  expect(screen.getByText("AI 연결이 불안정해 로컬 초안을 사용했어요.")).toBeTruthy()
  expect(screen.getByLabelText("본문 편집")).toBeTruthy()
  expect(screen.getByRole("button", { name: "본문 복사" })).toBeTruthy()
})
```

- [ ] **Step 2: Run the component test and verify RED**

Run: `npm run test:run -- tests/component/results.test.ts`

Expected: FAIL because the notice is absent.

- [ ] **Step 3: Render a non-blocking source notice per active channel**

In `ResultEditor.vue`, inside each success branch add:

```vue
<p v-if="naver.data.generationSource === 'local-fallback'" class="generation-source-notice">
  AI 연결이 불안정해 로컬 초안을 사용했어요.
</p>
```

Add the equivalent Instagram condition. Reuse existing quiet status styling or add only a focused `.generation-source-notice` rule if visual distinction is missing.

- [ ] **Step 4: Update fixtures and run component tests for GREEN**

Set existing successful output fixtures to `generationSource: "openai"`. Run:

`npm run test:run -- tests/component/results.test.ts tests/component/studio-generation-flow.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/features/studio/ResultEditor.vue src/app/styles.css tests/component/results.test.ts tests/fixtures.ts
git commit -m "2026-07-12 로컬 대체 생성 안내"
```

---

### Task 6: Provision the OpenAI secret safely and document operations

**Files:**
- Create: `scripts/provision-openai.mjs`
- Create: `tests/unit/openai-provision-script.test.ts`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: an API key entered through a TTY prompt.
- Produces: `npm run openai:provision`, which uploads only `OPENAI_API_KEY` to the `ap-yoga-content-studio` production secret environment.

- [ ] **Step 1: Write failing secret-safety tests**

Create `tests/unit/openai-provision-script.test.ts`:

```ts
it("provisions the OpenAI key only through an interactive secret command", () => {
  const script = readFileSync(path.join(root, "scripts/provision-openai.mjs"), "utf8")
  expect(script).toContain("process.stdin.isTTY")
  expect(script).toContain("setRawMode(true)")
  expect(script).toContain('"OPENAI_API_KEY"')
  expect(script).toContain('"wrangler", "pages", "secret", "put"')
  expect(script).not.toMatch(/sk-[A-Za-z0-9_-]{12,}/)
  expect(script).not.toContain("console.log(apiKey)")
})

it("keeps local OpenAI secret files out of Git", () => {
  const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8")
  expect(gitignore).toContain(".dev.vars")
  expect(gitignore).toContain(".env")
})
```

- [ ] **Step 2: Run the provisioning test and verify RED**

Run: `npm run test:run -- tests/unit/openai-provision-script.test.ts`

Expected: FAIL because the script and npm command do not exist.

- [ ] **Step 3: Implement hidden TTY provisioning**

Create `scripts/provision-openai.mjs` by extracting the existing hidden-input behavior from `scripts/provision-auth.mjs`. Validate only that the key is non-empty and at most 512 characters; do not enforce a public prefix. Pass the value to:

```js
spawnSync(
  "npx",
  ["wrangler", "pages", "secret", "put", "OPENAI_API_KEY", "--project-name", "ap-yoga-content-studio"],
  { input: `${apiKey}\n`, stdio: ["pipe", "inherit", "inherit"], encoding: "utf8" }
)
```

Overwrite the in-memory string in `finally` and print only `OPENAI_API_KEY 등록 완료`.

- [ ] **Step 4: Add the npm command, ignore rule, and operator documentation**

Add to `package.json`:

```json
"openai:provision": "node scripts/provision-openai.mjs"
```

Add `.env` and `.env.*` ignore rules while preserving a possible `.env.example` exception only if an example file is later added. Document in `README.md`:

```bash
npm run openai:provision
npm run deploy:cloudflare
```

State that the key is never exposed to the browser, Responses use `store: false`, Naver is at least 500 characters, and the shared chat key should be rotated after deployment.

- [ ] **Step 5: Run provisioning and deployment-contract tests for GREEN**

Run: `npm run test:run -- tests/unit/openai-provision-script.test.ts tests/unit/cloudflare-deployment.test.ts && git diff --check`

Expected: PASS and no key-like value in tracked files.

- [ ] **Step 6: Commit Task 6**

```bash
git add scripts/provision-openai.mjs tests/unit/openai-provision-script.test.ts package.json README.md .gitignore
git commit -m "2026-07-12 OpenAI secret 프로비저닝"
```

---

### Task 7: Full verification, production provisioning, deployment, and GitHub publication

**Files:**
- Modify only if verification reveals a tested defect.
- Verify: all files from Tasks 1–6.

**Interfaces:**
- Consumes: a clean `main` branch, authenticated Wrangler and GitHub CLI sessions, and the user-provided OpenAI key entered interactively.
- Produces: a verified production deployment and pushed `origin/main`.

- [ ] **Step 1: Run the complete non-browser verification suite**

Run:

```bash
npm run test:run
npm run typecheck
npm run typecheck:functions
npm run build
npm run test:e2e -- --list
git diff --check
```

Expected: all unit/component tests pass, typechecks pass, production PWA build succeeds, the default E2E collection excludes `auth-flow.spec.ts`, and the diff is clean.

- [ ] **Step 2: Scan tracked content for leaked credentials**

Run:

```bash
git grep -nE 'sk-(proj-)?[A-Za-z0-9_-]{12,}' -- . ':!package-lock.json'
git status --short
```

Expected: the grep exits with no matches. Only the pre-existing user-owned `AP_YOGA_Content_Studio_4Docs_v7/` and `Resource/` directories may remain untracked.

- [ ] **Step 3: Provision the production OpenAI key interactively**

Run: `npm run openai:provision`

Expected: Wrangler reports `OPENAI_API_KEY` uploaded. Enter the user-provided key only at the hidden prompt; never place it in the command line or a file.

- [ ] **Step 4: Deploy the production build**

Run: `npm run deploy:cloudflare`

Expected: Wrangler uploads the Functions bundle and returns a production deployment URL. The canonical URL remains `https://ap-yoga-content-studio.pages.dev/`.

- [ ] **Step 5: Verify the live authenticated generation flow**

Using the public canonical URL in a fresh browser session:

1. confirm `/` redirects to `/login` when signed out;
2. sign in with the configured application credentials;
3. create a draft with at least one test image and a short memo;
4. generate both channels;
5. verify both channel tabs succeed independently;
6. verify `naver.body.trim().length >= 500` in the rendered textarea;
7. verify Instagram long and short captions differ;
8. verify API and session responses use `Cache-Control: no-store`;
9. trigger a controlled upstream failure only in a disposable test environment, not production, and verify the local fallback notice.

Expected: all checks pass; no API key is observable in browser requests, HTML, JavaScript assets, or logs.

- [ ] **Step 6: Commit any verification-only documentation update**

If no source changes were required, skip this commit. If README verification notes changed:

```bash
git add README.md
git commit -m "2026-07-12 OpenAI 생성 운영 검증"
```

- [ ] **Step 7: Push the verified main branch**

Run: `git push origin main`

Expected: `origin/main` points to the local `HEAD` and GitHub shows the OpenAI integration without any secret value.
