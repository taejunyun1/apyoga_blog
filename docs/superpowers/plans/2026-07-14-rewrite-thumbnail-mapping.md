# AP YOGA 재작성 버튼 및 사진 매칭 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 결과 화면의 재작성 버튼이 GPT 기반으로 실제 문구를 바꾸고, 처리 상태와 변경 위치를 즉시 보여 주며, 업로드 사진과 채널별 문구 배치를 썸네일로 연결해 표시한다.

**Architecture:** Cloudflare Pages Function `POST /api/content/rewrite`가 OpenAI Responses API의 구조화 출력을 요청하고 서버에서 영역·길이·금지 표현·의료 단정을 검증한다. 브라우저 `OpenAIProvider`는 원격 결과가 실패하거나 잘못되면 `LocalAIProvider`로 대체하고, Pinia 스토어는 후보 반영·안전 검토·저장을 하나의 원자적 작업처럼 처리해 실패 시 이전 결과를 복구한다. Vue 결과 화면은 요청 키와 마지막 변경 미리보기를 관리하며, 별도 `ResultImageMap`이 `StudioImage.thumbnailUrl`과 결과의 이미지 ID를 결합한다.

**Tech Stack:** Vue 3, TypeScript, Pinia, Cloudflare Pages Functions, OpenAI Responses API Structured Outputs, Vitest, Testing Library Vue, Playwright, Wrangler.

**Approved design:** `docs/superpowers/specs/2026-07-14-rewrite-thumbnail-mapping-design.md`

**Authoritative references:** [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Cloudflare Workers Best Practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)

---

## Task 1: OpenAI 재작성 도메인 계약과 검증 추가

**Files:**

- Modify: `functions/lib/content-types.ts`
- Modify: `functions/lib/openai-content.ts`
- Create: `tests/unit/openai-rewrite.test.ts`

- [ ] **Step 1: 서버 재작성 계약을 실패 테스트로 고정한다**

`tests/unit/openai-rewrite.test.ts`를 만들고 다음 동작을 검증한다.

```ts
import { describe, expect, it, vi } from "vitest"
import {
  OpenAIContentError,
  requestOpenAIRewrite,
  validateRewriteContent,
} from "../../functions/lib/openai-content"
import type { RewriteContentInput } from "../../functions/lib/content-types"

const input: RewriteContentInput = {
  channel: "naver",
  section: "intro",
  instruction: "감성 줄이기",
  currentText: "조용한 감정이 오래 머무는 저녁이었습니다.",
  memo: "어깨와 흉곽을 살핀 수련",
  avoid: "치료, 완치",
  tone: "plain",
}

function completed(text: string, section = "intro") {
  return Response.json({
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ section, text }) }] }],
  })
}

describe("OpenAI rewrite content", () => {
  it("requests a strict rewrite schema without storing the response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completed("호흡을 살피며 수련을 시작했습니다."))
    const result = await requestOpenAIRewrite(input, { OPENAI_API_KEY: "test-key" }, {
      fetcher,
      safetyIdentifier: "hashed-user",
    })

    expect(result).toEqual({ section: "intro", text: "호흡을 살피며 수련을 시작했습니다." })
    const init = fetcher.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({ store: false, safety_identifier: "hashed-user" })
    expect(body.text.format).toMatchObject({ type: "json_schema", name: "rewrite_content", strict: true })
  })

  it.each([
    ["a mismatched section", { section: "title", text: "새 문구" }],
    ["unchanged text", { section: "intro", text: input.currentText }],
    ["a forbidden expression", { section: "intro", text: "치료를 위한 수련입니다." }],
    ["a direct medical claim", { section: "intro", text: "통증이 완치됩니다." }],
  ])("rejects %s", (_label, value) => {
    expect(() => validateRewriteContent(value, input)).toThrow(OpenAIContentError)
  })

  it("requires at least 500 characters for a Naver body", () => {
    expect(() => validateRewriteContent({ section: "body", text: "짧은 본문" }, {
      ...input,
      section: "body",
      currentText: "기존 본문 ".repeat(80),
    })).toThrow("500자")
  })

  it("requires every rewritten hashtag token to start with #", () => {
    expect(() => validateRewriteContent({ section: "hashtags", text: "#요가 잘못된태그" }, {
      ...input,
      channel: "instagram",
      section: "hashtags",
      currentText: "#에이피요가 #요가기록",
    })).toThrow("해시태그")
  })
})
```

- [ ] **Step 2: 새 테스트가 아직 구현되지 않아 실패하는지 확인한다**

Run:

```bash
npm test -- --run tests/unit/openai-rewrite.test.ts
```

Expected: `requestOpenAIRewrite`, `validateRewriteContent`, `RewriteContentInput`이 없어 타입 또는 import 오류로 실패한다.

- [ ] **Step 3: 서버 공유 타입을 추가한다**

`functions/lib/content-types.ts`에 허용 영역을 채널별로 제한하는 계약을 추가한다.

```ts
export type RewriteSection = "title" | "intro" | "body" | "hook" | "caption" | "short" | "hashtags"

export interface RewriteContentInput {
  channel: ContentChannel
  section: RewriteSection
  instruction: string
  currentText: string
  memo: string
  avoid: string
  tone: GenerateContentInput["tone"]
}

export interface RewrittenContent {
  section: RewriteSection
  text: string
}
```

- [ ] **Step 4: 구조화된 OpenAI 재작성 요청과 서버 검증을 구현한다**

`functions/lib/openai-content.ts`에서 기존 `OPENAI_RESPONSES_URL`, `MODEL`, `outputText`, 의료 단정 패턴을 재사용한다. `requestOpenAIRewrite()`는 이미지나 브리프를 받지 않고 아래 본문만 전송한다.

```ts
export async function requestOpenAIRewrite(
  input: RewriteContentInput,
  env: Pick<ContentEnv, "OPENAI_API_KEY">,
  options: { fetcher?: typeof fetch; safetyIdentifier: string; retryInstruction?: string },
): Promise<RewrittenContent> {
  let response: Response
  try {
    response = await (options.fetcher ?? fetch)(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        store: false,
        reasoning: { effort: "low" },
        safety_identifier: options.safetyIdentifier,
        instructions: rewritePrompt(input, options.retryInstruction),
        input: JSON.stringify(input),
        text: { format: rewriteSchema() },
      }),
    })
  } catch {
    throw new OpenAIContentError("AI 재작성 요청에 실패했어요.", true)
  }

  if (!response.ok) {
    throw new OpenAIContentError(
      "AI 재작성 요청에 실패했어요.",
      response.status === 429 || response.status >= 500,
    )
  }

  const payload = await response.json().catch(() => {
    throw new OpenAIContentError("AI 응답을 읽지 못했어요.", true)
  })
  if (!isRecord(payload) || payload.status !== "completed") {
    throw new OpenAIContentError("AI 재작성이 완료되지 않았어요.", true)
  }

  let value: unknown
  try {
    value = JSON.parse(outputText(payload))
  } catch (error) {
    if (error instanceof OpenAIContentError) throw error
    throw new OpenAIContentError("AI 응답 형식이 올바르지 않아요.", true)
  }
  return validateRewriteContent(value, input)
}
```

`validateRewriteContent()`는 정확히 `section`, `text` 두 키만 받고 다음을 시행한다.

```ts
export function validateRewriteContent(value: unknown, input: RewriteContentInput): RewrittenContent {
  if (!hasExactKeys(value, ["section", "text"])
    || value.section !== input.section
    || typeof value.text !== "string"
    || !value.text.trim()) {
    throw new OpenAIContentError("AI 재작성 형식이 올바르지 않아요.", true)
  }
  const text = value.text.trim()
  if (text === input.currentText.trim()) {
    throw new OpenAIContentError("이전과 다른 문구를 만들지 못했어요.", true)
  }
  if (input.channel === "naver" && input.section === "body" && text.length < 500) {
    throw new OpenAIContentError("네이버 본문은 500자 이상이어야 해요.", true)
  }
  if (input.section === "hashtags"
    && text.split(/\s+/).some((token) => !token.startsWith("#") || token.length < 2)) {
    throw new OpenAIContentError("해시태그 형식이 올바르지 않아요.", true)
  }
  if (forbiddenExpressions(input.avoid).some((expression) => text.includes(expression)) || hasMedicalClaim(text)) {
    throw new OpenAIContentError("금지 표현이 재작성 문구에 포함되었어요.", true)
  }
  return { section: value.section, text }
}
```

`rewritePrompt()`에는 현재 영역만 바꾸고 다른 사실을 발명하지 말 것, `instruction`, `memo`, `tone`, `avoid`를 지킬 것, 네이버 본문은 500자 이상 유지할 것, `철학 줄이기`는 추상적 단어를 구체적인 호흡·신체 감각으로 바꿀 것, `사진 설명 늘리기`는 입력에 없는 인물·동작·장소를 단정하지 말 것을 명시한다. `rewriteSchema()`는 `additionalProperties: false`, `required: ["section", "text"]`인 strict JSON schema를 반환한다.

- [ ] **Step 5: 재작성 서비스 테스트를 통과시킨다**

Run:

```bash
npm test -- --run tests/unit/openai-rewrite.test.ts
npm run typecheck:functions
```

Expected: 모든 재작성 서비스 테스트와 Functions 타입 검사가 통과한다.

- [ ] **Step 6: 첫 구현 단위를 커밋한다**

```bash
git add functions/lib/content-types.ts functions/lib/openai-content.ts tests/unit/openai-rewrite.test.ts
git commit -m "2026-07-14 OpenAI 재작성 계약 및 검증 추가"
```

---

## Task 2: Cloudflare Pages 재작성 Function 추가

**Files:**

- Create: `functions/api/content/rewrite.ts`
- Create: `tests/unit/content-rewrite-function.test.ts`
- Modify: `tests/unit/auth-middleware.test.ts`

- [ ] **Step 1: HTTP 경계의 실패 테스트를 작성한다**

`tests/unit/content-rewrite-function.test.ts`에 기존 생성 Function 테스트와 같은 `ContentEnv` fixture를 사용해 다음을 검증한다.

요청 fixture는 다음 정확한 계약을 사용한다.

```ts
function validInput(): RewriteContentInput {
  return {
    channel: "naver",
    section: "intro",
    instruction: "감성 줄이기",
    currentText: "조용한 감정이 오래 머무는 저녁이었습니다.",
    memo: "어깨와 흉곽을 살핀 수련",
    avoid: "치료, 완치",
    tone: "plain",
  }
}
```

요청과 의존성 helper 및 테스트 본문은 다음과 같이 작성한다.

```ts
function requestFor(input: unknown, headers: HeadersInit = {}): Request {
  return new Request("https://studio.example/api/content/rewrite", {
    method: "POST",
    headers: {
      Origin: "https://studio.example",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(input),
  })
}

function dependencies(rewrite = vi.fn().mockResolvedValue({
  section: "intro",
  text: "호흡을 살피며 시작했습니다.",
})) {
  return {
    rewrite,
    safetyIdentifier: vi.fn().mockResolvedValue("hashed-user"),
  }
}

describe("content rewrite Pages Function", () => {
  it("rejects cross-origin, non-JSON, and oversized requests", async () => {
    const crossOrigin = requestFor(validInput(), { Origin: "https://attacker.example" })
    expect((await handleContentRewrite(crossOrigin, env, dependencies())).status).toBe(403)

    const nonJson = new Request("https://studio.example/api/content/rewrite", {
      method: "POST",
      headers: { Origin: "https://studio.example", "Content-Type": "text/plain" },
      body: JSON.stringify(validInput()),
    })
    expect((await handleContentRewrite(nonJson, env, dependencies())).status).toBe(403)

    const oversized = requestFor(validInput(), { "Content-Length": "32769" })
    expect((await handleContentRewrite(oversized, env, dependencies())).status).toBe(413)
  })

  it("rejects an invalid channel-section pair", async () => {
    const rewrite = vi.fn()
    const response = await handleContentRewrite(
      requestFor({ ...validInput(), channel: "naver", section: "hook" }),
      env,
      dependencies(rewrite),
    )
    expect(response.status).toBe(400)
    expect(rewrite).not.toHaveBeenCalled()
  })

  it.each([
    ["an empty current text", { ...validInput(), currentText: "" }],
    ["a memo over 4,000 characters", { ...validInput(), memo: "가".repeat(4_001) }],
    ["an instruction over 100 characters", { ...validInput(), instruction: "가".repeat(101) }],
    ["an avoid list over 500 characters", { ...validInput(), avoid: "가".repeat(501) }],
  ])("rejects %s", async (_label, input) => {
    const rewrite = vi.fn()
    const response = await handleContentRewrite(requestFor(input), env, dependencies(rewrite))
    expect(response.status).toBe(400)
    expect(rewrite).not.toHaveBeenCalled()
  })

  it("fails closed when OPENAI_API_KEY is missing", async () => {
    const rewrite = vi.fn()
    const response = await handleContentRewrite(
      requestFor(validInput()),
      { ...env, OPENAI_API_KEY: "" },
      dependencies(rewrite),
    )
    expect(response.status).toBe(500)
    expect(rewrite).not.toHaveBeenCalled()
  })

  it("returns only source and rewritten data", async () => {
    const rewrite = vi.fn().mockResolvedValue({ section: "intro", text: "호흡을 살피며 시작했습니다." })
    const response = await handleContentRewrite(requestFor(validInput()), env, dependencies(rewrite))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      source: "openai",
      data: { section: "intro", text: "호흡을 살피며 시작했습니다." },
    })
  })

  it("retries one retryable validation failure and returns the second rewrite", async () => {
    const rewrite = vi.fn()
      .mockRejectedValueOnce(new OpenAIContentError("invalid", true))
      .mockResolvedValueOnce({ section: "intro", text: "두 번째 재작성 문구" })
    const response = await handleContentRewrite(requestFor(validInput()), env, dependencies(rewrite))
    expect(response.status).toBe(200)
    expect(rewrite).toHaveBeenCalledTimes(2)
    expect(rewrite.mock.calls[1][3]).toMatchObject({
      retryInstruction: "이전 결과의 오류를 수정하고 모든 재작성 제약을 충족하세요.",
    })
  })

  it("returns 502 after two retryable failures", async () => {
    const rewrite = vi.fn().mockRejectedValue(new OpenAIContentError("invalid", true))
    const response = await handleContentRewrite(requestFor(validInput()), env, dependencies(rewrite))
    expect(response.status).toBe(502)
    expect(rewrite).toHaveBeenCalledTimes(2)
  })

  it("does not retry a non-retryable OpenAI error", async () => {
    const rewrite = vi.fn().mockRejectedValue(new OpenAIContentError("bad request", false))
    const response = await handleContentRewrite(requestFor(validInput()), env, dependencies(rewrite))
    expect(response.status).toBe(502)
    expect(rewrite).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: 테스트가 Function 부재로 실패하는지 확인한다**

Run:

```bash
npm test -- --run tests/unit/content-rewrite-function.test.ts
```

Expected: `functions/api/content/rewrite.ts`를 찾지 못해 실패한다.

- [ ] **Step 3: same-origin JSON 재작성 Function을 구현한다**

`functions/api/content/rewrite.ts`는 기존 `generate.ts`와 같은 32,768-byte 제한, 실제 스트림 크기 측정, 인증 미들웨어 뒤의 same-origin JSON 검사, API 키 fail-closed 정책을 적용한다. 허용 조합은 다음 상수로 고정한다.

```ts
const SECTIONS: Record<ContentChannel, ReadonlySet<RewriteSection>> = {
  naver: new Set(["title", "intro", "body"]),
  instagram: new Set(["hook", "caption", "short", "hashtags"]),
}
```

문자열 한도는 `instruction: 100`, `currentText: 12_000`, `memo: 4_000`, `avoid: 500`으로 검사하고 알 수 없는 키를 거절한다. 핵심 핸들러는 의존성을 주입할 수 있게 작성한다.

```ts
interface RewriteDependencies {
  rewrite: typeof requestOpenAIRewrite
  safetyIdentifier(): string | Promise<string>
}

export async function handleContentRewrite(
  request: Request,
  env: ContentEnv,
  dependencies: RewriteDependencies = {
    rewrite: requestOpenAIRewrite,
    safetyIdentifier: () => hashedSafetyIdentifier(env.AUTH_USERNAME),
  },
): Promise<Response> {
  if (!isSameOriginJson(request)) return json({ message: "요청을 확인해 주세요." }, 403)
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY_BYTES) {
    return json({ message: "입력 내용이 너무 길어요." }, 413)
  }
  if (!env.OPENAI_API_KEY) return json({ message: "AI 설정을 확인해 주세요." }, 500)

  let input: RewriteContentInput
  try {
    input = validateRewriteRequest(await readJsonBody(request))
  } catch (error) {
    return json(
      { message: error instanceof RequestBodyTooLargeError ? "입력 내용이 너무 길어요." : "요청을 확인해 주세요." },
      error instanceof RequestBodyTooLargeError ? 413 : 400,
    )
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const data = await dependencies.rewrite(input, env, {
        safetyIdentifier: await dependencies.safetyIdentifier(),
        retryInstruction: attempt === 1 ? "이전 결과의 오류를 수정하고 모든 재작성 제약을 충족하세요." : undefined,
      })
      return json({ source: "openai", data })
    } catch (error) {
      if (!(error instanceof OpenAIContentError) || !error.retryable) break
    }
  }
  return json({ message: "AI 재작성이 지연되어 로컬 재작성으로 전환합니다." }, 502)
}
```

- [ ] **Step 4: 인증 미들웨어 회귀 테스트에 새 경로를 포함한다**

`tests/unit/auth-middleware.test.ts`의 보호 API 목록에 `new Request("https://studio.example/api/content/rewrite", { method: "POST" })`를 추가해 미인증 요청이 기존 생성 API와 동일하게 차단되는지 검증한다.

- [ ] **Step 5: Function 및 인증 테스트를 통과시킨다**

Run:

```bash
npm test -- --run tests/unit/content-rewrite-function.test.ts tests/unit/auth-middleware.test.ts
npm run typecheck:functions
```

Expected: 입력 경계, 재시도, API 키, 인증 회귀 테스트가 모두 통과한다.

- [ ] **Step 6: Function을 커밋한다**

```bash
git add functions/api/content/rewrite.ts tests/unit/content-rewrite-function.test.ts tests/unit/auth-middleware.test.ts
git commit -m "2026-07-14 콘텐츠 재작성 Pages Function 추가"
```

---

## Task 3: 브라우저 Provider 원격 호출과 안전한 로컬 대체 구현

**Files:**

- Modify: `src/adapters/openai-provider.ts`
- Modify: `tests/unit/openai-provider.test.ts`

- [ ] **Step 1: Provider 재작성 실패 테스트를 먼저 추가한다**

`tests/unit/openai-provider.test.ts`에 다음 사례를 추가한다.

```ts
const rewriteInput = {
  channel: "naver" as const,
  section: "intro",
  instruction: "감성 줄이기",
  currentText: "조용한 감정이 오래 머무는 저녁이었습니다.",
  memo: "어깨와 흉곽을 살핀 수련",
  avoid: "치료, 완치",
  tone: "plain" as const,
}

it("requests a remote rewrite without photo data", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    source: "openai",
    data: { section: "intro", text: "호흡을 살피며 수련을 시작했습니다." },
  }))
  const provider = new OpenAIProvider({ fetcher, local: new LocalAIProvider() })

  await expect(provider.rewriteSection(rewriteInput)).resolves.toEqual({
    section: "intro",
    text: "호흡을 살피며 수련을 시작했습니다.",
  })
  expect(fetcher.mock.calls[0][0]).toBe("/api/content/rewrite")
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(rewriteInput)
})

it.each([
  ["a 502 response", () => new Response(null, { status: 502 })],
  ["malformed JSON", () => new Response("{", { status: 200 })],
  ["a mismatched section", () => Response.json({ source: "openai", data: { section: "title", text: "새 제목" } })],
  ["unchanged text", () => Response.json({ source: "openai", data: { section: "intro", text: rewriteInput.currentText } })],
  ["a forbidden expression", () => Response.json({ source: "openai", data: { section: "intro", text: "치료를 위한 글" } })],
])("uses the local rewrite for %s", async (_label, response) => {
  const local = new LocalAIProvider()
  const fallback = vi.spyOn(local, "rewriteSection")
  const provider = new OpenAIProvider({ fetcher: vi.fn<typeof fetch>().mockResolvedValue(response()), local })
  const result = await provider.rewriteSection(rewriteInput)
  expect(result.text).not.toBe(rewriteInput.currentText)
  expect(fallback).toHaveBeenCalledOnce()
})

it.each([401, 403])("requires authentication for rewrite status %s", async (status) => {
  const onAuthRequired = vi.fn()
  const local = new LocalAIProvider()
  const fallback = vi.spyOn(local, "rewriteSection")
  const provider = new OpenAIProvider({
    fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status })),
    local,
    onAuthRequired,
  })
  await expect(provider.rewriteSection(rewriteInput)).rejects.toThrow("로그인이 필요해요")
  expect(onAuthRequired).toHaveBeenCalledOnce()
  expect(fallback).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: 기존 로컬 위임 때문에 원격 요청 테스트가 실패하는지 확인한다**

Run:

```bash
npm test -- --run tests/unit/openai-provider.test.ts
```

Expected: 재작성 fetch가 호출되지 않거나 원격 결과가 반환되지 않아 새 테스트가 실패한다.

- [ ] **Step 3: 원격 재작성과 응답 검증을 구현한다**

`OpenAIProvider.rewriteSection()`을 `async`로 바꾸고, 네트워크 실패·5xx·2xx 잘못된 envelope에서는 로컬 재작성을 호출한다. 401/403은 기존 로그인 이동 경계를 재사용한다.

```ts
async rewriteSection(input: RewriteInput) {
  let response: Response
  try {
    response = await (this.options.fetcher ?? fetch)("/api/content/rewrite", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
  } catch {
    return this.local.rewriteSection(input)
  }

  if (response.status === 401 || response.status === 403) {
    const onAuthRequired = this.options.onAuthRequired ?? defaultOnAuthRequired
    onAuthRequired()
    throw new Error("로그인이 필요해요.")
  }
  if (!response.ok) return this.local.rewriteSection(input)

  const remote = await readRemoteRewrite(response, input)
  return remote ?? this.local.rewriteSection(input)
}
```

`readRemoteRewrite()`는 `source`, `data`만 있는 exact envelope, 같은 `section`, 비어 있지 않고 기존과 다른 `text`, 네이버 body 500자, 해시태그 토큰, `avoid` 포함 여부와 직접 의료 단정을 검사한다. 실패는 `null`을 반환해 한 번만 로컬로 대체한다. 요청 JSON에는 `RewriteInput`의 일곱 필드만 존재하는지 테스트로 보장한다.

- [ ] **Step 4: Provider 테스트와 앱 타입 검사를 통과시킨다**

Run:

```bash
npm test -- --run tests/unit/openai-provider.test.ts
npm run typecheck
```

Expected: 원격 성공, 로컬 대체, 인증, 최소 요청 데이터 테스트가 통과한다.

- [ ] **Step 5: Provider 변경을 커밋한다**

```bash
git add src/adapters/openai-provider.ts tests/unit/openai-provider.test.ts
git commit -m "2026-07-14 브라우저 GPT 재작성 및 로컬 대체 연결"
```

---

## Task 4: 스토어 재작성을 원자적으로 적용하고 실패 시 복구

**Files:**

- Modify: `src/features/studio/studio-store.ts`
- Modify: `tests/unit/studio-store.test.ts`

- [ ] **Step 1: 반환값·안전 검토·롤백 실패 테스트를 추가한다**

`tests/unit/studio-store.test.ts`에 다음 회귀 테스트를 추가한다.

```ts
it("returns the visible rewritten section after review and persistence", async () => {
  const repository = new InMemoryRepository()
  configureStudioServices({ repository, ai: new LocalAIProvider() })
  const store = useStudioStore()
  store.draft = readyDraft()
  await store.generateAll()

  const result = await store.rewrite({ channel: "naver", section: "intro", instruction: "감성 줄이기" })

  expect(result).toEqual({ section: "intro", text: store.draft.naver.data?.introOptions[0] })
  expect(repository.saveCalls).toBeGreaterThan(1)
})

it("restores the previous result and review when persistence fails", async () => {
  class FailingRepository extends InMemoryRepository {
    failNextSave = false
    override async saveDraft(...args: Parameters<InMemoryRepository["saveDraft"]>) {
      if (this.failNextSave) {
        this.failNextSave = false
        throw new Error("임시 저장 실패")
      }
      return super.saveDraft(...args)
    }
  }
  const repository = new FailingRepository()
  configureStudioServices({ repository, ai: new LocalAIProvider() })
  const store = useStudioStore()
  store.draft = readyDraft()
  await store.generateAll()
  const before = structuredClone({ naver: store.draft.naver, review: store.draft.review, updatedAt: store.draft.updatedAt })
  repository.failNextSave = true

  await expect(store.rewrite({ channel: "naver", section: "intro", instruction: "감성 줄이기" }))
    .rejects.toThrow("임시 저장 실패")
  expect({ naver: store.draft.naver, review: store.draft.review, updatedAt: store.draft.updatedAt }).toEqual(before)
})

it("keeps the previous result when the rewritten candidate contains an avoided term", async () => {
  class UnsafeProvider extends LocalAIProvider {
    override async rewriteSection(input: RewriteInput) {
      return { section: input.section, text: "치료를 보장하는 새 문구" }
    }
  }
  const repository = new InMemoryRepository()
  configureStudioServices({ repository, ai: new UnsafeProvider() })
  const store = useStudioStore()
  store.draft = readyDraft()
  store.draft.avoid = "치료"
  await store.generateAll()
  const before = structuredClone(store.draft.naver)

  await expect(store.rewrite({ channel: "naver", section: "intro", instruction: "감성 줄이기" }))
    .rejects.toThrow("금지 표현")
  expect(store.draft.naver).toEqual(before)
})
```

- [ ] **Step 2: 현재 스토어가 결과를 반환하지 않고 저장 실패 후 변경을 남기는지 확인한다**

Run:

```bash
npm test -- --run tests/unit/studio-store.test.ts
```

Expected: 반환값과 롤백 테스트가 실패한다.

- [ ] **Step 3: 후보 스냅샷과 복구 경계를 구현한다**

`rewrite()` 시작 시 결과 채널, review, updatedAt을 `structuredClone()`으로 보존한다. Provider 결과를 검증한 후에만 적용하고 `refreshReview()`와 `saveNow()`가 모두 성공하면 `RewriteOutput`을 반환한다. 어느 단계에서든 실패하면 메모리 상태를 복구하고 오류를 다시 던진다.

```ts
async function rewrite(request: { channel: "naver" | "instagram"; section: string; instruction: string }) {
  if (!draft.value) throw new Error("작성 중인 글이 없어요.")
  const current = draft.value
  const before = {
    naver: structuredClone(current.naver),
    instagram: structuredClone(current.instagram),
    review: structuredClone(current.review),
    updatedAt: current.updatedAt,
  }
  const currentText = sectionText(current, request.channel, request.section)

  try {
    const rewritten = await services.ai.rewriteSection({
      ...request,
      currentText,
      memo: current.sourceMemo,
      avoid: current.avoid,
      tone: request.channel === "naver" ? current.naverTone : current.instagramTone,
    })
    validateRewriteCandidate(rewritten, currentText, request, current.avoid)
    applyRewrite(current, request.channel, request.section, rewritten.text)
    await refreshReview(current)
    current.updatedAt = new Date().toISOString()
    await saveNow()
    return rewritten
  } catch (error) {
    current.naver = before.naver
    current.instagram = before.instagram
    current.review = before.review
    current.updatedAt = before.updatedAt
    throw error
  }
}
```

`validateRewriteCandidate()`는 같은 영역, 변경된 텍스트, 네이버 body 500자, 해시태그 `#` 형식, 쉼표·줄바꿈으로 나눈 `avoid` 표현을 검사한다. `applyRewrite()`는 기존 분기를 옮겨 한 영역만 수정한다. `refreshReview()` 후 `review.passed === false` 자체는 기존 직접 편집 정책처럼 저장 가능하지만, 새 후보가 의료 단정을 새로 추가한 경우에는 오류로 처리해 이전 상태를 복구한다.

- [ ] **Step 4: 기존 재작성 회귀와 새 원자성 테스트를 모두 통과시킨다**

Run:

```bash
npm test -- --run tests/unit/studio-store.test.ts
npm run typecheck
```

Expected: 기존 500자·동일 문구 테스트와 새 반환값·금지 표현·저장 실패 롤백 테스트가 통과한다.

- [ ] **Step 5: 스토어 변경을 커밋한다**

```bash
git add src/features/studio/studio-store.ts tests/unit/studio-store.test.ts
git commit -m "2026-07-14 재작성 검증 및 저장 실패 롤백 추가"
```

---

## Task 5: 채널별 사진-문구 썸네일 매칭 컴포넌트 구현

**Files:**

- Create: `src/features/studio/ResultImageMap.vue`
- Create: `tests/component/result-image-map.test.ts`
- Modify: `src/features/studio/ResultEditor.vue`
- Modify: `tests/component/results.test.ts`
- Modify: `src/views/StudioView.vue`

- [ ] **Step 1: 사진 매칭 표시의 실패 테스트를 작성한다**

`tests/component/result-image-map.test.ts`에서 `studioImages(3)`를 사용해 다음을 검증한다.

```ts
describe("ResultImageMap", () => {
  it("sorts Naver placements and connects each caption to its thumbnail", () => {
    render(ResultImageMap, {
      props: {
        channel: "naver",
        images: studioImages(3),
        placements: [
          { imageId: "image-2", afterParagraph: 3, caption: "마무리 호흡 장면" },
          { imageId: "image-1", afterParagraph: 1, caption: "수련을 시작하는 장면" },
        ],
        imageOrder: [],
        coverImageId: "",
      },
    })
    const cards = screen.getAllByRole("listitem")
    expect(cards[0].textContent).toContain("문단 1 뒤")
    expect(cards[0].textContent).toContain("수련을 시작하는 장면")
    expect(screen.getByRole("img", { name: "수련을 시작하는 장면" })).toHaveAttribute("src", "blob:photo-1")
  })

  it("shows Instagram order and the cover badge", () => {
    render(ResultImageMap, {
      props: {
        channel: "instagram",
        images: studioImages(3),
        placements: [],
        imageOrder: ["image-3", "image-1", "image-2"],
        coverImageId: "image-3",
      },
    })
    expect(screen.getAllByRole("listitem")[0].textContent).toContain("1번째")
    expect(screen.getAllByRole("listitem")[0].textContent).toContain("대표 사진")
  })

  it("keeps a readable card when an image ID is missing", () => {
    render(ResultImageMap, {
      props: {
        channel: "naver",
        images: studioImages(1),
        placements: [{ imageId: "missing", afterParagraph: 2, caption: "확인할 사진" }],
        imageOrder: [],
        coverImageId: "",
      },
    })
    expect(screen.getByText("사진을 불러올 수 없어요")).toBeTruthy()
    expect(screen.getByText("확인할 사진")).toBeTruthy()
  })
})
```

`tests/component/results.test.ts`의 모든 render helper에 `images: studioImages(3)`를 넘기고, 네이버 카드와 인스타그램 탭 전환 후 순서 카드가 각각 노출되는 통합 테스트를 추가한다.

- [ ] **Step 2: 컴포넌트가 없어 테스트가 실패하는지 확인한다**

Run:

```bash
npm test -- --run tests/component/result-image-map.test.ts tests/component/results.test.ts
```

Expected: `ResultImageMap.vue` import 오류 또는 `images` prop 부재로 실패한다.

- [ ] **Step 3: 의미 있는 카드 마크업을 구현한다**

`ResultImageMap.vue` props는 다음처럼 고정한다.

```ts
defineProps<{
  channel: "naver" | "instagram"
  images: StudioImage[]
  placements: NaverOutput["imagePlacements"]
  imageOrder: string[]
  coverImageId: string
}>()
```

네이버는 `placements.toSorted((a, b) => a.afterParagraph - b.afterParagraph)`, 인스타그램은 `imageOrder`를 그대로 사용한다. `Map(images.map(image => [image.id, image]))`로 썸네일을 찾고, `<section aria-labelledby>`, `<ol class="result-image-map__list">`, `<li class="result-image-card">`를 렌더링한다. 썸네일이 있으면 `loading="lazy"`와 캡션 기반 `alt`를 적용하고, 없으면 같은 크기의 `<div class="result-image-card__missing">사진을 불러올 수 없어요</div>`를 표시한다.

표시 문구는 다음으로 통일한다.

- 네이버 제목: `사진과 글 배치`
- 네이버 순서: `문단 ${afterParagraph} 뒤`
- 인스타그램 제목: `사진 게시 순서`
- 인스타그램 순서: `${index + 1}번째`
- 대표 배지: `대표 사진`

- [ ] **Step 4: 결과 편집기와 실제 draft 이미지 배열을 연결한다**

`ResultEditor.vue`에 `images: StudioImage[]` prop을 추가하고 기존 텍스트 전용 `.placement-list`를 제거한다. 네이버 본문 아래에는:

```vue
<ResultImageMap
  channel="naver"
  :images="images"
  :placements="naver.data.imagePlacements"
  :image-order="[]"
  cover-image-id=""
/>
```

인스타그램 긴·짧은 캡션 아래에는:

```vue
<ResultImageMap
  channel="instagram"
  :images="images"
  :placements="[]"
  :image-order="instagram.data.imageOrder"
  :cover-image-id="instagram.data.coverImageId"
/>
```

`StudioView.vue`의 `ResultEditor`에 `:images="store.draft.images"`를 전달한다. 이미지 데이터는 화면 prop으로만 흐르고 `/api/content/rewrite` 요청에는 포함하지 않는다.

- [ ] **Step 5: 사진 매칭 단위·통합 테스트를 통과시킨다**

Run:

```bash
npm test -- --run tests/component/result-image-map.test.ts tests/component/results.test.ts
npm run typecheck
```

Expected: 네이버 문단 순서, 캡션, 인스타그램 게시 순서, 대표 사진 배지, 누락 이미지 상태가 통과한다.

- [ ] **Step 6: 썸네일 매칭 UI를 커밋한다**

```bash
git add src/features/studio/ResultImageMap.vue src/features/studio/ResultEditor.vue src/views/StudioView.vue tests/component/result-image-map.test.ts tests/component/results.test.ts
git commit -m "2026-07-14 결과 사진 및 문구 매칭 카드 추가"
```

---

## Task 6: 재작성 버튼 진행 상태·구체적 토스트·변경 미리보기 구현

**Files:**

- Modify: `src/features/studio/RewriteActionSheet.vue`
- Modify: `src/features/studio/ResultEditor.vue`
- Modify: `src/views/StudioView.vue`
- Modify: `tests/component/results.test.ts`
- Modify: `tests/component/studio-generation-flow.test.ts`

- [ ] **Step 1: 버튼 상태와 사용자 피드백 실패 테스트를 작성한다**

`tests/component/results.test.ts`에 pending key와 preview props를 추가하고 다음을 검증한다.

```ts
it("disables every rewrite action and labels the active request while rewriting", () => {
  render(ResultEditor, {
    props: {
      naver,
      instagram: successfulInstagram,
      images: studioImages(3),
      review,
      copyFallback: null,
      pendingRewriteKey: "naver:body:사진 설명 늘리기",
      rewritePreviews: {},
    },
  })
  expect(screen.getByRole("button", { name: "사진 설명 늘리기 변경 중…" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "도입부 감성 줄이기" })).toBeDisabled()
})

it("shows the last rewritten text directly below the actions", () => {
  render(ResultEditor, {
    props: {
      naver,
      instagram: successfulInstagram,
      images: studioImages(3),
      review,
      copyFallback: null,
      pendingRewriteKey: null,
      rewritePreviews: {
        naver: { section: "title", label: "새 제목", text: "호흡과 감각을 따라간 수련" },
      },
    },
  })
  expect(screen.getByText("최근 변경 · 새 제목")).toBeTruthy()
  expect(screen.getByText("호흡과 감각을 따라간 수련")).toBeTruthy()
})
```

`tests/component/studio-generation-flow.test.ts`의 기존 `문구를 변경했어요` 기대를 아래처럼 바꾸고, 지연 Provider로 버튼 상태를 검증한다.

```ts
await fireEvent.click(screen.getByRole("button", { name: "도입부 감성 줄이기" }))
await waitFor(() => expect(screen.getByText("도입부의 감성을 줄였어요")).toBeTruthy())
expect(screen.getByText("최근 변경 · 도입부")).toBeTruthy()
expect(screen.getByText(store.draft?.naver.data?.introOptions[0] ?? "")).toBeTruthy()
```

저장 실패 경로에서는 성공 토스트와 preview가 갱신되지 않는 테스트를 추가한다.

- [ ] **Step 2: 현재 generic toast와 무상태 버튼 때문에 테스트가 실패하는지 확인한다**

Run:

```bash
npm test -- --run tests/component/results.test.ts tests/component/studio-generation-flow.test.ts
```

Expected: pending props, `변경 중…`, 구체적 토스트, 최근 변경 미리보기가 없어 실패한다.

- [ ] **Step 3: 요청 키 기반 버튼 상태를 구현한다**

`RewriteActionSheet.vue`에 `pendingKey: string | null` prop을 추가한다. 각 버튼의 키는 `${channel}:${section}:${instruction}`으로 만들고, 어떤 요청이든 pending이면 모든 재작성 버튼을 `disabled` 처리한다. 활성 버튼은 시각 문구와 접근 가능한 이름 모두 `원래 문구 변경 중…`이 되며 `aria-busy="true"`를 가진다.

```vue
<button
  type="button"
  :disabled="pendingKey !== null"
  :aria-busy="pendingKey === keyFor('body', '사진 설명 늘리기')"
  @click="emitRewrite('body', '사진 설명 늘리기')"
>
  {{ pendingKey === keyFor('body', '사진 설명 늘리기') ? '사진 설명 늘리기 변경 중…' : '사진 설명 늘리기' }}
</button>
```

- [ ] **Step 4: 채널별 마지막 변경 미리보기와 정확한 토스트를 구현한다**

`StudioView.vue`에 다음 상태를 추가한다.

```ts
interface RewritePreview {
  section: string
  label: string
  text: string
}

const pendingRewriteKey = ref<string | null>(null)
const rewritePreviews = ref<Partial<Record<"naver" | "instagram", RewritePreview>>>({})
```

요청별 문구는 exact map으로 관리한다.

```ts
const rewriteFeedback: Record<string, { preview: string; toast: string }> = {
  "naver:intro:감성 줄이기": { preview: "도입부", toast: "도입부의 감성을 줄였어요" },
  "naver:body:철학 줄이기": { preview: "네이버 본문", toast: "본문의 철학적 표현을 줄였어요" },
  "naver:body:사진 설명 늘리기": { preview: "네이버 본문", toast: "사진 설명을 보강했어요" },
  "naver:title:최근 글과 다르게": { preview: "새 제목", toast: "새 제목을 만들었어요" },
  "instagram:hook:첫 문장만 변경": { preview: "첫 문장", toast: "첫 문장을 변경했어요" },
  "instagram:short:더 짧게": { preview: "짧은 캡션", toast: "캡션을 더 짧게 만들었어요" },
  "instagram:hashtags:해시태그 변경": { preview: "해시태그", toast: "해시태그를 변경했어요" },
}
```

`rewriteResult()`는 중복 클릭을 막고 성공 시에만 preview와 toast를 바꾼다.

```ts
async function rewriteResult(request: { channel: "naver" | "instagram"; section: string; instruction: string }) {
  if (pendingRewriteKey.value) return
  const key = `${request.channel}:${request.section}:${request.instruction}`
  pendingRewriteKey.value = key
  error.value = null
  try {
    const rewritten = await store.rewrite(request)
    const feedback = rewriteFeedback[key]
    rewritePreviews.value = {
      ...rewritePreviews.value,
      [request.channel]: {
        section: rewritten.section,
        label: feedback.preview,
        text: rewritten.text,
      },
    }
    showToast(feedback.toast)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "문구를 변경하지 못했어요."
  } finally {
    pendingRewriteKey.value = null
  }
}
```

`ResultEditor.vue`가 `pendingRewriteKey`와 `rewritePreviews`를 받고, 각 `RewriteActionSheet` 바로 다음에 해당 채널 preview를 렌더링한다.

```vue
<aside v-if="rewritePreviews.naver" class="rewrite-preview" aria-live="polite">
  <strong>최근 변경 · {{ rewritePreviews.naver.label }}</strong>
  <p>{{ rewritePreviews.naver.text }}</p>
</aside>
```

- [ ] **Step 5: 버튼·토스트·미리보기 테스트를 통과시킨다**

Run:

```bash
npm test -- --run tests/component/results.test.ts tests/component/studio-generation-flow.test.ts
npm run typecheck
```

Expected: 중복 클릭 방지, 모든 버튼 disabled, 클릭 버튼 진행 문구, 구체적 토스트, 성공 시 preview, 실패 시 원문과 preview 보존이 통과한다.

- [ ] **Step 6: 재작성 피드백 UI를 커밋한다**

```bash
git add src/features/studio/RewriteActionSheet.vue src/features/studio/ResultEditor.vue src/views/StudioView.vue tests/component/results.test.ts tests/component/studio-generation-flow.test.ts
git commit -m "2026-07-14 재작성 진행 상태 및 결과 미리보기 추가"
```

---

## Task 7: 포인터 커서와 반응형 썸네일 스타일 완성

**Files:**

- Modify: `src/app/styles.css`
- Modify: `tests/e2e/studio-flow.spec.ts`

- [ ] **Step 1: 브라우저 행태를 E2E 테스트로 고정한다**

`tests/e2e/studio-flow.spec.ts`에서 `/api/content/rewrite`를 성공 응답으로 intercept한다. 응답 text는 요청 `section`을 유지하고, body이면 500자 이상의 새 본문, 그 외에는 현재 문구와 다른 값을 반환한다.

```ts
await page.route("**/api/content/rewrite", async (route) => {
  const request = route.request().postDataJSON() as { section: string }
  const text = request.section === "body"
    ? "호흡과 사진 속 수련 장면을 구체적으로 살핀 새 본문입니다. ".repeat(18)
    : "호흡과 감각을 담아 새롭게 바꾼 문구"
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ source: "openai", data: { section: request.section, text } }),
  })
})
```

결과 화면에서 다음을 검증한다.

```ts
const rewriteButton = page.getByRole("button", { name: "도입부 감성 줄이기" })
await expect(rewriteButton).toHaveCSS("cursor", "pointer")
await rewriteButton.click()
await expect(page.getByText("도입부의 감성을 줄였어요")).toBeVisible()
await expect(page.getByText("최근 변경 · 도입부")).toBeVisible()
await expect(page.getByText("호흡과 감각을 담아 새롭게 바꾼 문구")).toBeVisible()
await expect(page.getByRole("heading", { name: "사진과 글 배치" })).toBeVisible()
await expect(page.locator(".result-image-card img")).toHaveCount(2)
```

인스타그램 탭에서는 `사진 게시 순서`, `대표 사진`, 첫 번째 썸네일을 확인한다. 모바일 프로젝트에서는 `.result-image-map__list`의 `overflow-x`가 `auto`, 카드 폭이 컨테이너보다 작은지 확인하고, 데스크톱 프로젝트에서는 `display: grid`인지 확인한다. 양쪽 모두 문서 전체의 수평 overflow가 없어야 한다.

- [ ] **Step 2: 새 스타일 기대가 실패하는지 확인한다**

Run:

```bash
npm run test:e2e -- tests/e2e/studio-flow.spec.ts
```

Expected: 전역 버튼 cursor가 `default`이고 사진 카드/미리보기가 없어 실패한다.

- [ ] **Step 3: 활성·비활성 버튼 커서를 전역에서 일관되게 만든다**

`src/app/styles.css`의 기본 button 규칙 다음에 추가한다.

```css
button:not(:disabled) {
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
}
```

기존 개별 `cursor` 규칙은 충돌하지 않도록 유지하거나 같은 의미이면 제거한다.

- [ ] **Step 4: 승인된 기존 디자인 토큰으로 썸네일과 미리보기를 스타일링한다**

```css
.result-image-map {
  display: grid;
  gap: 10px;
}

.result-image-map h3 {
  margin: 0;
  font-size: 0.88rem;
}

.result-image-map__list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.result-image-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--ap-border);
  border-radius: var(--ap-control-radius);
  background: var(--ap-surface);
}

.result-image-card img,
.result-image-card__missing {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
}

.result-image-card__missing {
  display: grid;
  place-items: center;
  background: var(--ap-bg);
  color: var(--ap-muted);
  padding: 12px;
  font-size: 0.75rem;
  text-align: center;
}

.result-image-card__body {
  display: grid;
  gap: 5px;
  padding: 10px;
}

.result-image-card__meta,
.result-image-card__badge {
  color: #9d6128;
  font-size: 0.72rem;
  font-weight: 700;
}

.result-image-card__caption {
  margin: 0;
  color: var(--ap-muted);
  font-size: 0.78rem;
  line-height: 1.45;
}

.rewrite-preview {
  display: grid;
  gap: 6px;
  border-left: 3px solid var(--ap-accent);
  background: var(--ap-bg);
  padding: 12px;
}

.rewrite-preview strong {
  font-size: 0.78rem;
}

.rewrite-preview p {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  color: var(--ap-muted);
  font-size: 0.8rem;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

@media (max-width: 767px) {
  .result-image-map__list {
    display: flex;
    overflow-x: auto;
    padding-bottom: 4px;
    scroll-snap-type: x proximity;
  }

  .result-image-card {
    flex: 0 0 min(72vw, 240px);
    scroll-snap-align: start;
  }
}
```

모바일 입력 확대 방지용 기존 16px 규칙은 그대로 보존한다.

- [ ] **Step 5: 모바일·데스크톱 E2E를 통과시키고 스크린샷을 생성한다**

Run:

```bash
npm run test:e2e -- tests/e2e/studio-flow.spec.ts
```

Expected: `mobile-chromium`, `desktop-chromium` 모두 통과하며 각 프로젝트의 `completed-flow.png`가 생성된다.

- [ ] **Step 6: 참조 화면과 구현 화면을 시각 비교한다**

`view_image`로 아래 두 종류를 직접 확인한다.

- 참조: `/var/folders/d4/9023wbyd59z561jrjy476lsh0000gn/T/TemporaryItems/NSIRD_screencaptureui_lCsYoC/Screenshot 2026-07-14 at 01.20.14.png`
- 구현: Playwright 결과 폴더의 최신 `completed-flow.png` 모바일·데스크톱 파일

다음 fidelity ledger를 기록한다.

1. 기존 흰색 결과 패널, 갈색 보조 텍스트, 둥근 테두리 버튼 스타일이 유지되는가.
2. 네 개 재작성 버튼의 문구·배치·간격이 참조 화면과 일관적인가.
3. 변경 미리보기가 버튼 바로 아래에 있어 화면 밖 변경을 찾지 않아도 되는가.
4. 썸네일과 문단 번호/캡션 또는 게시 순서/대표 배지가 한 카드 안에서 명확히 매칭되는가.
5. 모바일에서 한 장 이상 보이고 가로 스크롤이 가능하며 문서 자체는 좌우로 넘치지 않는가.
6. 본문 textarea가 모바일에서 16px로 유지되어 자동 확대가 재발하지 않는가.

불일치가 있으면 CSS 또는 마크업을 수정한 뒤 해당 E2E와 스크린샷 확인을 반복한다.

- [ ] **Step 7: UI 스타일과 E2E를 커밋한다**

```bash
git add src/app/styles.css tests/e2e/studio-flow.spec.ts
git commit -m "2026-07-14 재작성 버튼 및 반응형 사진 카드 스타일 완성"
```

---

## Task 8: 전체 검증, 코드 리뷰, Cloudflare 배포와 운영 확인

**Files:**

- Verify only unless review finds a scoped defect

- [ ] **Step 1: 전체 정적·단위·컴포넌트 검증을 실행한다**

Run:

```bash
npm run typecheck
npm run typecheck:functions
npm run test:run
npm run build
```

Expected: Vue 타입, Functions 타입, 전체 Vitest, production build가 모두 exit code 0으로 끝난다.

- [ ] **Step 2: 전체 모바일·데스크톱 브라우저 회귀를 실행한다**

Run:

```bash
npm run test:e2e
```

Expected: 인증 전용 suite를 제외한 모든 Playwright 테스트가 두 viewport에서 통과하고 빈 화면, 콘솔 오류, 문서 수평 overflow가 없다.

- [ ] **Step 3: 요청 범위에 대한 코드 리뷰를 수행한다**

`superpowers:requesting-code-review`를 사용해 다음을 검토한다.

- 원격 재작성 요청에 이미지 바이너리·썸네일 URL·개인정보가 포함되지 않는가.
- same-origin, 인증, 크기 제한, API key secret binding이 유지되는가.
- 원격·로컬 실패와 저장 실패에서 기존 콘텐츠가 보존되는가.
- 네이버 본문 500자, 금지 표현, 의료 단정, 해시태그 검증이 서버·브라우저 경계에서 우회되지 않는가.
- pending 상태에서 중복 요청이 불가능하고 실패 시 성공 토스트가 나타나지 않는가.
- 누락 이미지가 결과 화면 전체를 깨뜨리지 않는가.

발견된 범위 내 결함은 실패 테스트를 먼저 추가하고 수정한 뒤 관련 테스트와 전체 검증을 다시 실행한다.

- [ ] **Step 4: 사용자 소유 파일을 제외한 변경 상태를 확인한다**

Run:

```bash
git status --short
git diff --check
git log --oneline -8
```

Expected: `AP_YOGA_Content_Studio_4Docs_v7/`, `Resource/`는 계속 untracked 상태로 보존되고 커밋에 포함되지 않는다. `git diff --check`는 출력 없이 성공한다.

- [ ] **Step 5: Cloudflare Pages production에 배포한다**

Run:

```bash
npm run deploy:cloudflare
```

Expected: Wrangler가 production branch `master` 배포를 성공시키고 새 deployment URL을 출력한다. API 키는 기존 Cloudflare secret binding을 사용하며 소스나 명령 인자로 다시 기록하지 않는다.

- [ ] **Step 6: 운영 URL에서 실제 기능을 점검한다**

`browser:control-in-app-browser`로 사용자의 기존 로그인 탭을 사용하거나 새 운영 탭을 열고 다음을 확인한다.

- `https://ap-yoga-content-studio.pages.dev`가 AP YOGA Content Studio인지 식별한다.
- 로그인 세션이 유효한 경우 기존 draft 결과 화면을 열고, 유효하지 않으면 사용자에게 로그인만 요청하고 비밀번호를 자동 입력하거나 노출하지 않는다.
- 재작성 버튼의 computed cursor가 `pointer`이다.
- 클릭 중 `변경 중…`과 disabled 상태가 나타난다.
- 완료 후 해당 문구가 실제로 달라지고 구체적 toast와 최근 변경 preview가 나타난다.
- 네이버 썸네일 카드에 문단 번호·캡션, 인스타그램 카드에 게시 순서·대표 사진이 표시된다.
- 콘솔 error/warning이 없고 network의 `/api/content/rewrite`가 200 또는 정상 로컬 대체 경로로 끝난다.

사용자의 기존 탭을 claim했다면 검증 종료 시 반드시 release하고 탭은 열린 상태로 둔다.

- [ ] **Step 7: 현재 branch를 GitHub에 push한다**

Run:

```bash
git push -u origin codex/rewrite-thumbnail-mapping
```

Expected: `taejunyun1/apyoga_blog.git`에 현재 커밋이 push된다. 사용자 지시 없이 `main`/`master`를 force push하거나 병합하지 않는다.

- [ ] **Step 8: 최종 보고 전 증거를 다시 확인한다**

`superpowers:verification-before-completion`을 사용해 가장 최근 명령 출력과 운영 브라우저 검증을 근거로 완료 여부를 판단한다. 최종 응답에는 다음만 간결하게 제공한다.

- 운영 테스트 링크
- 재작성 버튼, 포인터/진행 상태, 구체적 toast, 사진 매칭 카드가 완료되었다는 요약
- 전체 테스트/build/E2E 통과 수치
- GitHub branch 링크
- 참조 화면 대비 fidelity ledger 6개 항목의 결과
- 사용자가 직접 시험할 순서: 로그인 → 기존 글 결과 → 재작성 버튼 → 사진 배치 확인
