# A.P YOGA Password Change and Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로그인한 관리자가 앱에서 비밀번호를 변경하고 모든 기존 세션을 즉시 무효화하며, 비밀번호를 잊은 경우 숨김 터미널 명령으로 안전하게 초기화할 수 있게 한다.

**Architecture:** `AUTH_DB` D1의 단일 자격 증명 행을 활성 비밀번호 해시와 인증 버전의 source of truth로 사용하고, 행이 없을 때만 기존 Pages secret을 사용한다. 모든 인증 경로는 D1 primary에서 최신 버전을 읽으며, 버전이 포함된 서명 세션과 현재 비밀번호 재검증을 결합한다. 관리자 초기화는 새 secret 배포가 성공한 뒤 D1 override를 삭제한다.

**Tech Stack:** Vue 3.5, Pinia 3, Vue Router 5, Cloudflare Pages Functions, Cloudflare D1, Workers KV, Node.js 22, TypeScript 5.9, Vitest 4, Playwright 1.61, Wrangler 4.

## Global Constraints

- 평문 비밀번호, 파생 해시, `SESSION_SECRET`, Cloudflare 관리 토큰을 브라우저 bundle·Git·파일·명령 인수·로그에 기록하지 않는다.
- 앱 내 변경은 현재 비밀번호를 다시 확인하고 새 비밀번호 12~256 UTF-16 code unit, 기존 비밀번호와 다름을 서버에서 검증한다.
- D1 인증 읽기는 `AUTH_DB.withSession("first-primary")`로 시작하며 D1 오류 때 secret으로 우회하지 않는다.
- 첫 앱 내 변경 직후 기존 `v: 1` 및 이전 인증 버전의 `v: 2` 세션을 모두 거부한다.
- 변경 API는 same-origin JSON, 2,048-byte body limit, exact-key validation, `Cache-Control: no-store`를 적용한다.
- 현재 비밀번호 실패는 별도 `password-change` 범위에서 5회/10분 제한한다.
- 관리자 초기화는 secret 갱신 → 배포 성공 → D1 override 삭제 → 새 비밀번호 로그인 확인 순서를 지킨다.
- 이메일·SMS 복구, 다중 계정, 가입·초대, Pages Functions 안의 Cloudflare 관리 토큰은 구현하지 않는다.
- 사용자 소유 `AP_YOGA_Content_Studio_4Docs_v7/`와 `Resource/`는 읽기 전용으로 보존하고 Git에 추가하지 않는다.

---

## File Responsibility Map

- `migrations/0001_auth_credentials.sql`: 단일 관리자 자격 증명 D1 schema.
- `functions/lib/env.ts`: D1 최소 binding interface와 선택적 runtime binding 선언.
- `functions/lib/credentials.ts`: D1/secret 활성 자격 증명 조회와 D1 교체.
- `functions/lib/auth.ts`: PBKDF2 record 생성, versioned session 발급·검증.
- `functions/api/auth/login.ts`, `session.ts`, `functions/_middleware.ts`: 활성 자격 증명과 세션 버전 적용.
- `functions/api/auth/password.ts`: 현재 비밀번호 재확인과 새 비밀번호 저장.
- `functions/lib/rate-limit.ts`: 로그인과 비밀번호 변경 실패 key scope 분리.
- `src/features/auth/auth-client.ts`, `auth-store.ts`: 브라우저 변경 요청과 인증 상태 전환.
- `src/views/ChangePasswordView.vue`: 보호된 변경 폼.
- `src/views/LoginView.vue`, `HomeView.vue`, `src/app/router.ts`, `src/app/styles.css`: 진입점·성공 안내·화면 구성.
- `scripts/reset-auth.mjs`: production 관리자 초기화 orchestration.
- `wrangler.jsonc`, `package.json`, `README.md`: D1 binding, 명령, 운영 절차.

---

### Task 1: Add the D1 credential repository boundary

**Files:**
- Create: `migrations/0001_auth_credentials.sql`
- Create: `functions/lib/credentials.ts`
- Modify: `functions/lib/env.ts`
- Create: `tests/unit/auth-credentials.test.ts`

**Interfaces:**
- Consumes: `AUTH_PASSWORD_HASH`, `SESSION_SECRET`, optional runtime `AUTH_DB` binding.
- Produces: `ActiveCredential`, `readActiveCredential(env)`, `changeCredential(env, passwordHash, version, updatedAt)`.

- [ ] **Step 1: Write failing repository tests**

Create `tests/unit/auth-credentials.test.ts` with a small real fake that records SQL behavior:

```ts
import { describe, expect, it } from "vitest"
import { changeCredential, readActiveCredential } from "../../functions/lib/credentials"
import type { AuthDatabase, AuthDatabaseSession, AuthDatabaseStatement, AuthEnv } from "../../functions/lib/env"

class FakeStatement implements AuthDatabaseStatement {
  values: unknown[] = []
  constructor(
    private readonly row: Record<string, unknown> | null,
    private readonly onRun: (values: unknown[]) => void,
  ) {}
  bind(...values: unknown[]) { this.values = values; return this }
  async first<T>() { return this.row as T | null }
  async run() { this.onRun(this.values); return { success: true } }
}

class FakeSession implements AuthDatabaseSession {
  readonly runs: unknown[][] = []
  constructor(readonly row: Record<string, unknown> | null) {}
  prepare() { return new FakeStatement(this.row, (values) => this.runs.push(values)) }
}

class FakeDatabase implements AuthDatabase {
  constraint: string | null = null
  constructor(readonly session: FakeSession) {}
  withSession(constraint: "first-primary") { this.constraint = constraint; return this.session }
}

function env(database?: AuthDatabase): AuthEnv {
  return {
    AUTH_USERNAME: "studio-user",
    AUTH_PASSWORD_HASH: "secret-password-record",
    SESSION_SECRET: "test-session-secret",
    AUTH_RATE_LIMIT: { get: async () => null, put: async () => undefined, delete: async () => undefined },
    AUTH_DB: database,
  }
}

describe("active credential repository", () => {
  it("reads the latest D1 credential from the primary", async () => {
    const database = new FakeDatabase(new FakeSession({
      password_hash: "d1-password-record",
      credential_version: "version-2",
    }))
    await expect(readActiveCredential(env(database))).resolves.toEqual({
      passwordHash: "d1-password-record",
      version: "version-2",
      source: "d1",
    })
    expect(database.constraint).toBe("first-primary")
  })

  it("uses a non-reversible derived version with the secret record only when no row exists", async () => {
    const result = await readActiveCredential(env(new FakeDatabase(new FakeSession(null))))
    expect(result.source).toBe("secret")
    expect(result.passwordHash).toBe("secret-password-record")
    expect(result.version).toMatch(/^[a-f0-9]{32}$/)
    expect(result.version).not.toContain("secret-password-record")
  })

  it("fails closed when AUTH_DB is absent", async () => {
    await expect(readActiveCredential(env())).rejects.toThrow("인증 저장소")
  })

  it("upserts one credential row", async () => {
    const session = new FakeSession(null)
    await changeCredential(env(new FakeDatabase(session)), "new-record", "version-3", "2026-07-12T12:00:00.000Z")
    expect(session.runs).toEqual([[1, "new-record", "version-3", "2026-07-12T12:00:00.000Z"]])
  })
})
```

- [ ] **Step 2: Run the repository test for RED**

Run:

```bash
npm run test:run -- tests/unit/auth-credentials.test.ts
```

Expected: FAIL because `credentials.ts` and D1 interfaces do not exist.

- [ ] **Step 3: Add the migration and minimal D1 interfaces**

Create `migrations/0001_auth_credentials.sql`:

```sql
CREATE TABLE IF NOT EXISTS auth_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  credential_version TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Add to `functions/lib/env.ts`:

```ts
export interface AuthDatabaseStatement {
  bind(...values: unknown[]): AuthDatabaseStatement
  first<T>(): Promise<T | null>
  run(): Promise<{ success: boolean }>
}

export interface AuthDatabaseSession {
  prepare(query: string): AuthDatabaseStatement
}

export interface AuthDatabase {
  withSession(constraint: "first-primary"): AuthDatabaseSession
}
```

Add `AUTH_DB?: AuthDatabase` to `AuthEnv`. It is optional in the TypeScript type so incomplete-binding tests can construct the runtime failure explicitly; authentication code must treat absence as an error.

- [ ] **Step 4: Implement the credential repository**

Create `functions/lib/credentials.ts`:

```ts
import type { AuthEnv } from "./env"

export interface ActiveCredential {
  passwordHash: string
  version: string
  source: "secret" | "d1"
}

interface CredentialRow {
  password_hash: string
  credential_version: string
}

async function secretVersion(passwordHash: string, sessionSecret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(sessionSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`credential:${passwordHash}`)))
  return Array.from(bytes.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function primary(env: AuthEnv) {
  if (!env.AUTH_DB) throw new Error("인증 저장소를 사용할 수 없어요.")
  return env.AUTH_DB.withSession("first-primary")
}

export async function readActiveCredential(env: AuthEnv): Promise<ActiveCredential> {
  const row = await primary(env)
    .prepare("SELECT password_hash, credential_version FROM auth_credentials WHERE id = ?1")
    .bind(1)
    .first<CredentialRow>()
  if (row) {
    if (typeof row.password_hash !== "string" || !row.password_hash
      || typeof row.credential_version !== "string" || !row.credential_version) {
      throw new Error("인증 저장소의 값이 올바르지 않아요.")
    }
    return { passwordHash: row.password_hash, version: row.credential_version, source: "d1" }
  }
  if (!env.AUTH_PASSWORD_HASH || !env.SESSION_SECRET) throw new Error("인증 설정을 확인해 주세요.")
  return {
    passwordHash: env.AUTH_PASSWORD_HASH,
    version: await secretVersion(env.AUTH_PASSWORD_HASH, env.SESSION_SECRET),
    source: "secret",
  }
}

export async function changeCredential(
  env: AuthEnv,
  passwordHash: string,
  version: string,
  updatedAt: string,
): Promise<void> {
  const result = await primary(env)
    .prepare(`INSERT INTO auth_credentials (id, password_hash, credential_version, updated_at)
      VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(id) DO UPDATE SET
        password_hash = excluded.password_hash,
        credential_version = excluded.credential_version,
        updated_at = excluded.updated_at`)
    .bind(1, passwordHash, version, updatedAt)
    .run()
  if (!result.success) throw new Error("인증 저장소를 갱신하지 못했어요.")
}
```

- [ ] **Step 5: Run focused tests for GREEN**

Run:

```bash
npm run test:run -- tests/unit/auth-credentials.test.ts tests/unit/auth-functions.test.ts
npm run typecheck:functions
git diff --check
```

Expected: credential tests pass; existing authentication tests and Functions typecheck remain green.

- [ ] **Step 6: Commit Task 1**

```bash
git add migrations/0001_auth_credentials.sql functions/lib/env.ts functions/lib/credentials.ts tests/unit/auth-credentials.test.ts
git commit -m "2026-07-12 D1 인증 자격 증명 저장소"
```

---

### Task 2: Bind login and sessions to the active credential version

**Files:**
- Modify: `functions/lib/auth.ts`
- Modify: `functions/api/auth/login.ts`
- Modify: `functions/api/auth/session.ts`
- Modify: `functions/_middleware.ts`
- Modify: `tests/unit/auth-crypto.test.ts`
- Modify: `tests/unit/auth-functions.test.ts`
- Modify: `tests/unit/auth-middleware.test.ts`
- Modify: authentication `AuthEnv` fixtures found by `rg -l 'AUTH_PASSWORD_HASH' tests functions`

**Interfaces:**
- Consumes: `readActiveCredential(env): Promise<ActiveCredential>` from Task 1.
- Produces: `createPasswordRecord(password)`, versioned `createSession`, credential-aware `verifySession`.

- [ ] **Step 1: Write failing PBKDF2 and versioned-session tests**

Add to `tests/unit/auth-crypto.test.ts`:

```ts
import { createPasswordRecord, createSession, verifyPassword, verifySession } from "../../functions/lib/auth"

it("creates salted records compatible with verification", async () => {
  const first = await createPasswordRecord("new-password-123")
  const second = await createPasswordRecord("new-password-123")
  expect(first).not.toBe(second)
  await expect(verifyPassword("new-password-123", first)).resolves.toBe(true)
  await expect(verifyPassword("wrong-password-123", first)).resolves.toBe(false)
})

it("binds a v2 session to the active credential version", async () => {
  const token = await createSession("studio-user", "dGVzdC1zZWNyZXQ", "version-2", 1_000)
  await expect(verifySession(token, "studio-user", "dGVzdC1zZWNyZXQ", "version-2", false, 1_001)).resolves.toBe(true)
  await expect(verifySession(token, "studio-user", "dGVzdC1zZWNyZXQ", "version-3", false, 1_001)).resolves.toBe(false)
})

it("allows a legacy v1 session only while the secret credential is active", async () => {
  const legacy = await createSession("studio-user", "dGVzdC1zZWNyZXQ", undefined, 1_000)
  await expect(verifySession(legacy, "studio-user", "dGVzdC1zZWNyZXQ", "secret-version", true, 1_001)).resolves.toBe(true)
  await expect(verifySession(legacy, "studio-user", "dGVzdC1zZWNyZXQ", "d1-version", false, 1_001)).resolves.toBe(false)
})
```

Add login/session/middleware tests that use a fake `AUTH_DB` row and assert:

```ts
expect(verifyPasswordSpy).toHaveBeenCalledWith("test-password", "d1-password-record")
expect((await handleSession(versionedCookieRequest, d1Env)).status).toBe(200)
expect((await handleSession(staleVersionCookieRequest, d1Env)).status).toBe(401)
expect((await protectRequest(staleVersionRequest, d1Env, next)).status).toBe(401)
```

Also assert missing or throwing `AUTH_DB` causes login `500`, session `401`, private API `401`, and private page redirect without using the secret hash.

- [ ] **Step 2: Run versioning tests for RED**

Run:

```bash
npm run test:run -- tests/unit/auth-crypto.test.ts tests/unit/auth-functions.test.ts tests/unit/auth-middleware.test.ts
```

Expected: FAIL because record creation and credential-version session signatures do not exist.

- [ ] **Step 3: Add PBKDF2 record generation and versioned session payloads**

In `functions/lib/auth.ts`, export:

```ts
export async function createPasswordRecord(password: string): Promise<string> {
  if (password.length < 12 || password.length > 256) throw new Error("비밀번호는 12자 이상 256자 이하로 입력해 주세요.")
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const derived = await derivePassword(password, salt, 100_000)
  return `pbkdf2-sha256$100000$${encode(salt)}$${encode(derived)}`
}
```

Change `createSession` so an omitted version emits the old `v: 1` payload only for tests/backward compatibility, while a supplied version emits:

```ts
{ v: 2, sub: username, iat: nowSeconds, exp: nowSeconds + SESSION_SECONDS, cv: credentialVersion }
```

Change verification to:

```ts
export async function verifySession(
  token: string,
  username: string,
  secret: string,
  expectedVersion: string,
  allowLegacyV1: boolean,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean>
```

Require identical signature, subject, timestamps and lifetime. Accept `v: 2` only when `cv === expectedVersion`; accept `v: 1` only when `allowLegacyV1` is true.

- [ ] **Step 4: Resolve active credentials in every authentication path**

In login:

```ts
const credential = await readActiveCredential(env)
const passwordValid = await verifyPassword(password, credential.passwordHash)
const token = await createSession(env.AUTH_USERNAME, env.SESSION_SECRET, credential.version)
```

Wrap D1/config errors in the existing generic `500` login response. Do not fall back inside the catch.

In session and middleware:

```ts
const credential = await readActiveCredential(env)
const authenticated = Boolean(token && await verifySession(
  token,
  env.AUTH_USERNAME,
  env.SESSION_SECRET,
  credential.version,
  credential.source === "secret",
))
```

Return the existing unauthenticated response or redirect on any credential-store error.

- [ ] **Step 5: Update test fixtures and run GREEN**

For fixtures that do not exercise D1 behavior, add a reusable fake binding whose `first()` resolves `null` and whose `run()` resolves `{ success: true }`. Do not weaken runtime missing-binding checks.

Run:

```bash
npm run test:run -- tests/unit/auth-crypto.test.ts tests/unit/auth-credentials.test.ts tests/unit/auth-functions.test.ts tests/unit/auth-middleware.test.ts tests/unit/content-generation-function.test.ts
npm run typecheck:functions
git diff --check
```

Expected: all focused tests and Functions typecheck pass.

- [ ] **Step 6: Commit Task 2**

```bash
git add functions/lib/auth.ts functions/api/auth/login.ts functions/api/auth/session.ts functions/_middleware.ts tests
git commit -m "2026-07-12 인증 버전 기반 세션 무효화"
```

---

### Task 3: Implement the authenticated password-change endpoint

**Files:**
- Create: `functions/api/auth/password.ts`
- Modify: `functions/lib/rate-limit.ts`
- Create: `tests/unit/password-change-function.test.ts`
- Modify: `tests/unit/auth-functions.test.ts`
- Modify: `tests/unit/auth-middleware.test.ts`

**Interfaces:**
- Consumes: `readActiveCredential`, `changeCredential`, `createPasswordRecord`, `verifyPassword`, `expiredSessionCookie`.
- Produces: `handlePasswordChange(request, env, nowSeconds)` and Pages `onRequestPost`.

- [ ] **Step 1: Write failing request-boundary and success tests**

Create `tests/unit/password-change-function.test.ts` with a fake D1 credential store and requests built as:

```ts
function passwordRequest(body: unknown, init: RequestInit = {}) {
  return new Request("https://studio.example/api/auth/password", {
    method: "POST",
    headers: { Origin: "https://studio.example", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  })
}
```

Cover these explicit assertions:

```ts
expect((await handlePasswordChange(passwordRequest({
  currentPassword: "test-password",
  newPassword: "new-password-123",
}), env)).status).toBe(204)
expect(database.latest.passwordHash).not.toContain("new-password-123")
await expect(verifyPassword("new-password-123", database.latest.passwordHash)).resolves.toBe(true)
expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0")
expect(response.headers.get("Cache-Control")).toBe("no-store")
```

Add separate tests for wrong current password `401`, sixth failure `429`, new password shorter than 12 `400`, longer than 256 `400`, same password `400`, unknown key `400`, malformed JSON `400`, cross-origin/non-JSON `403`, declared and streamed body over 2,048 bytes `413`, D1 write failure `503`, and no cookie expiry on any failure.

- [ ] **Step 2: Run endpoint tests for RED**

Run:

```bash
npm run test:run -- tests/unit/password-change-function.test.ts
```

Expected: FAIL because the endpoint does not exist.

- [ ] **Step 3: Add scoped rate-limit keys**

Change `rateLimitKey` to:

```ts
export async function rateLimitKey(
  request: Request,
  secret: string,
  scope: "login" | "password-change" = "login",
): Promise<string>
```

Sign `${scope}:${address}` and return `${scope}:${hex}`. Keep existing login callers unchanged and add a test that login and password-change keys differ without containing the raw IP.

- [ ] **Step 4: Implement the bounded password endpoint**

Create `functions/api/auth/password.ts`. Read the body with a stream reader that stops and cancels immediately after byte 2,049. Reject exact keys other than `currentPassword` and `newPassword`.

Use this bounded reader so a false or missing `Content-Length` cannot bypass the limit:

```ts
async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("Content-Length") ?? 0)
  if (Number.isFinite(declared) && declared > maxBytes) throw new PasswordBodyTooLargeError()
  if (!request.body) return request.json()

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new PasswordBodyTooLargeError()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder().decode(bytes))
}
```

Define `PasswordBodyTooLargeError` in the same file and map only that error to `413`; map JSON parse errors to `400`.

The handler order must be:

```ts
if (!isSameOriginJson(request)) return json({ message: "요청을 확인해 주세요." }, 403)
if (!env.AUTH_RATE_LIMIT || !env.SESSION_SECRET || !env.AUTH_DB) return json({ message: "비밀번호를 변경하지 못했어요." }, 500)
const body = await readBoundedJson(request, 2_048)
const fields = validatePasswordBody(body)
const key = await rateLimitKey(request, env.SESSION_SECRET, "password-change")
const failures = await readFailures(env, key, nowSeconds)
if (failures.count >= 5) return json({ message: "확인 시도가 많아요. 10분 후 다시 시도해 주세요." }, 429)
const active = await readActiveCredential(env)
if (!await verifyPassword(fields.currentPassword, active.passwordHash)) {
  await recordFailure(env, key, failures, nowSeconds)
  return json({ message: "현재 비밀번호를 확인해 주세요." }, 401)
}
if (await verifyPassword(fields.newPassword, active.passwordHash)) {
  return json({ message: "새 비밀번호는 현재 비밀번호와 달라야 해요." }, 400)
}
const record = await createPasswordRecord(fields.newPassword)
await changeCredential(env, record, crypto.randomUUID(), new Date(nowSeconds * 1_000).toISOString())
await clearFailures(env, key)
return new Response(null, {
  status: 204,
  headers: { "Cache-Control": "no-store", "Set-Cookie": expiredSessionCookie() },
})
```

Map store exceptions to generic `503` and never include exception text in responses. Password locals must be overwritten with null-character strings in `finally` as a best-effort cleanup.

- [ ] **Step 5: Confirm middleware protection and GREEN**

Add `/api/auth/password` assertions to middleware tests: it is not in `PUBLIC`, an unauthenticated request gets `401`, and a current version session reaches `next`.

Run:

```bash
npm run test:run -- tests/unit/password-change-function.test.ts tests/unit/auth-functions.test.ts tests/unit/auth-middleware.test.ts tests/unit/auth-http.test.ts
npm run typecheck:functions
git diff --check
```

Expected: all focused endpoint/security tests pass.

- [ ] **Step 6: Commit Task 3**

```bash
git add functions/api/auth/password.ts functions/lib/rate-limit.ts tests/unit/password-change-function.test.ts tests/unit/auth-functions.test.ts tests/unit/auth-middleware.test.ts
git commit -m "2026-07-12 현재 비밀번호 확인 변경 API"
```

---

### Task 4: Add the protected password-change UI

**Files:**
- Create: `src/views/ChangePasswordView.vue`
- Modify: `src/features/auth/auth-client.ts`
- Modify: `src/features/auth/auth-store.ts`
- Modify: `src/app/router.ts`
- Modify: `src/views/HomeView.vue`
- Modify: `src/views/LoginView.vue`
- Modify: `src/app/styles.css`
- Create: `tests/component/change-password-view.test.ts`
- Modify: `tests/component/login-view.test.ts`
- Modify: `tests/component/auth-routing.test.ts`

**Interfaces:**
- Consumes: `POST /api/auth/password` from Task 3.
- Produces: `AuthClient.changePassword`, `auth.changePassword`, `/account/password`, success query notice.

- [ ] **Step 1: Write failing client/store and component tests**

Extend test `AuthClient` fakes with:

```ts
changePassword: vi.fn().mockResolvedValue(undefined)
```

Create `tests/component/change-password-view.test.ts` and cover:

```ts
expect(wrapper.get("[name=currentPassword]").attributes("autocomplete")).toBe("current-password")
expect(wrapper.get("[name=newPassword]").attributes("autocomplete")).toBe("new-password")
expect(wrapper.get("[name=confirmPassword]").attributes("autocomplete")).toBe("new-password")
```

Submit mismatch values and assert no client call plus the exact alert `새 비밀번호 확인이 일치하지 않아요.`. Submit matching values and assert:

```ts
expect(changePassword).toHaveBeenCalledWith("test-password", "new-password-123")
expect(auth.status).toBe("unauthenticated")
expect(router.currentRoute.value.fullPath).toBe("/login?password=changed")
expect(indexedDB.deleteDatabase).not.toHaveBeenCalled()
```

Add pending-state assertions for all fields/button, and server-error assertions that all three fields become empty.

- [ ] **Step 2: Run UI tests for RED**

Run:

```bash
npm run test:run -- tests/component/change-password-view.test.ts tests/component/login-view.test.ts tests/component/auth-routing.test.ts
```

Expected: FAIL because client method, view and route do not exist.

- [ ] **Step 3: Add the browser client and store operation**

Extend `AuthClient`:

```ts
changePassword(currentPassword: string, newPassword: string): Promise<void>
```

Implement `BrowserAuthClient.changePassword` with same-origin credentials, JSON body, and the shared response-message parser. In the Pinia store:

```ts
async function changePassword(currentPassword: string, newPassword: string) {
  await client.changePassword(currentPassword, newPassword)
  status.value = "unauthenticated"
}
```

Return it from the store.

- [ ] **Step 4: Implement the protected form and routes**

Create `/account/password` in `src/app/router.ts` without `meta.public`:

```ts
{ path: "/account/password", name: "change-password", component: () => import("@/views/ChangePasswordView.vue") }
```

Build `ChangePasswordView.vue` with labeled password inputs, `minlength="12"`, `maxlength="256"`, accessible `role="alert"` and `role="status"`, and this submit logic:

```ts
async function submit() {
  error.value = null
  if (newPassword.value !== confirmPassword.value) {
    error.value = "새 비밀번호 확인이 일치하지 않아요."
    return
  }
  busy.value = true
  try {
    await auth.changePassword(currentPassword.value, newPassword.value)
    await router.replace({ name: "login", query: { password: "changed" } })
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "비밀번호를 변경하지 못했어요."
  } finally {
    currentPassword.value = ""
    newPassword.value = ""
    confirmPassword.value = ""
    busy.value = false
  }
}
```

Add a `비밀번호 변경` `RouterLink` to the Home header. Add a cancel link back home.

In `LoginView.vue`, render the exact status when `route.query.password === "changed"` and add quiet text: `비밀번호를 잊으셨나요? 관리자 터미널에서 npm run auth:reset을 실행하세요.`

Use existing auth-card, field, primary-action and quiet-note visual language. Add only layout rules required for the header action group and password help; no redesign.

- [ ] **Step 5: Run component, routing and app regression tests for GREEN**

Run:

```bash
npm run test:run -- tests/component/change-password-view.test.ts tests/component/login-view.test.ts tests/component/auth-routing.test.ts tests/component/studio-generation-flow.test.ts
npm run typecheck
git diff --check
```

Expected: all focused tests and Vue typecheck pass.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/views/ChangePasswordView.vue src/features/auth/auth-client.ts src/features/auth/auth-store.ts src/app/router.ts src/views/HomeView.vue src/views/LoginView.vue src/app/styles.css tests/component/change-password-view.test.ts tests/component/login-view.test.ts tests/component/auth-routing.test.ts
git commit -m "2026-07-12 비밀번호 변경 화면과 로그인 안내"
```

---

### Task 5: Add the failure-safe administrator reset command

**Files:**
- Create: `scripts/reset-auth.mjs`
- Create: `tests/unit/auth-reset-script.test.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: interactive TTY, Wrangler OAuth, `ap-yoga-content-studio`, `ap-yoga-auth`, canonical production login endpoint.
- Produces: `npm run auth:reset`.

- [ ] **Step 1: Write failing reset-script safety tests**

Create `tests/unit/auth-reset-script.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("administrator password reset", () => {
  const source = readFileSync("scripts/reset-auth.mjs", "utf8")

  it("uses hidden TTY input and never passes password values as arguments", () => {
    expect(source).toContain("process.stdin.isTTY")
    expect(source).toContain("setRawMode(true)")
    expect(source).toContain('putSecret("AUTH_PASSWORD_HASH"')
    expect(source).toContain('putSecret("SESSION_SECRET"')
    expect(source).toContain("input: `${value}\\n`")
    expect(source).not.toMatch(/sk-[A-Za-z0-9_-]{12,}/)
    expect(source).not.toContain("console.log(password")
  })

  it("deploys before deleting the D1 override and verifies login last", () => {
    const deploy = source.indexOf('["run", "deploy:cloudflare"]')
    const removeOverride = source.indexOf('"DELETE FROM auth_credentials WHERE id = 1"')
    const verifyLogin = source.indexOf("/api/auth/login")
    expect(deploy).toBeGreaterThan(-1)
    expect(removeOverride).toBeGreaterThan(deploy)
    expect(verifyLogin).toBeGreaterThan(removeOverride)
  })
})
```

Add a package/README contract assertion for `"auth:reset": "node scripts/reset-auth.mjs"`.

- [ ] **Step 2: Run reset-script tests for RED**

Run:

```bash
npm run test:run -- tests/unit/auth-reset-script.test.ts tests/unit/auth-provision-script.test.ts tests/unit/cloudflare-deployment.test.ts
```

Expected: FAIL because the reset script and npm command are absent.

- [ ] **Step 3: Implement hidden confirmation and failure-safe ordering**

Create `scripts/reset-auth.mjs` using the existing raw-mode handler, with two hidden reads. Validate nonempty, equality, 12~256 length before any external command.

Use helpers with these exact command shapes:

```js
spawnSync("npx", ["wrangler", "pages", "secret", "put", name, "--project-name", "ap-yoga-content-studio"], {
  input: `${value}\n`, stdio: ["pipe", "inherit", "inherit"], encoding: "utf8",
})

spawnSync("npm", ["run", "deploy:cloudflare"], { stdio: "inherit", encoding: "utf8" })

spawnSync("npx", [
  "wrangler", "d1", "execute", "ap-yoga-auth", "--remote", "--command",
  "DELETE FROM auth_credentials WHERE id = 1",
], { stdio: "inherit", encoding: "utf8" })
```

After D1 deletion, call production `/api/auth/login` with `fetch`, same-origin headers and the new password kept only in memory. Require `204`; then POST `/api/auth/logout` using the returned cookie if present. Print only `관리자 비밀번호 초기화 완료`.

Generate the PBKDF2 record and new base64url session secret locally as in `provision-auth.mjs`. In `finally`, overwrite password, confirmation, password hash and session secret strings with equal-length null strings.

- [ ] **Step 4: Document the operator workflow**

Add to `package.json`:

```json
"auth:reset": "node scripts/reset-auth.mjs"
```

Update README with:

```bash
npm run auth:reset
```

State the exact order, that the command invalidates every session, that it must run from a TTY, and that interrupted/failed runs must not be reported as complete. Distinguish `auth:provision` for initial setup from `auth:reset` for recovery.

- [ ] **Step 5: Run reset safety and documentation tests for GREEN**

Run:

```bash
npm run test:run -- tests/unit/auth-reset-script.test.ts tests/unit/auth-provision-script.test.ts tests/unit/cloudflare-deployment.test.ts
npm run typecheck
npm run typecheck:functions
git diff --check
```

Expected: all script contracts and both typechecks pass. Do not run the real reset command in this task.

- [ ] **Step 6: Commit Task 5**

```bash
git add scripts/reset-auth.mjs tests/unit/auth-reset-script.test.ts package.json README.md
git commit -m "2026-07-12 관리자 비밀번호 초기화 명령"
```

---

### Task 6: Provision D1, migrate, deploy and verify production

**Files:**
- Modify: `wrangler.jsonc` with the actual D1 ID returned by Wrangler.
- Modify: `tests/unit/cloudflare-deployment.test.ts`
- Modify only if a verified defect requires a tested correction.

**Interfaces:**
- Consumes: completed Tasks 1–5, authenticated Wrangler/GitHub sessions, operator-entered temporary and final passwords.
- Produces: production `AUTH_DB` binding, applied migration, verified password change/reset flow, pushed `origin/main`.

- [ ] **Step 1: Write the failing D1 deployment-contract test**

Add to `tests/unit/cloudflare-deployment.test.ts`:

```ts
it("binds the production authentication D1 database and migration", () => {
  const config = JSON.parse(readFileSync(path.join(root, "wrangler.jsonc"), "utf8")) as Record<string, unknown>
  const d1 = (config.d1_databases as Array<Record<string, string>> | undefined) ?? []
  expect(d1).toHaveLength(1)
  expect(d1[0]).toMatchObject({ binding: "AUTH_DB", database_name: "ap-yoga-auth" })
  expect(d1[0].database_id).toMatch(/^[a-f0-9-]{36}$/)
  expect(readFileSync(path.join(root, "migrations/0001_auth_credentials.sql"), "utf8"))
    .toContain("CREATE TABLE IF NOT EXISTS auth_credentials")
})
```

- [ ] **Step 2: Run the contract test for RED**

Run:

```bash
npm run test:run -- tests/unit/cloudflare-deployment.test.ts
```

Expected: FAIL because `wrangler.jsonc` has no `AUTH_DB` binding.

- [ ] **Step 3: Create D1 and add the returned ID to Wrangler config**

Run:

```bash
npx wrangler d1 create ap-yoga-auth --location apac
```

Wrangler returns a UUID. Add exactly that returned value to `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "AUTH_DB",
    "database_name": "ap-yoga-auth",
    "database_id": "copy the exact UUID printed by the immediately preceding Wrangler command here"
  }
]
```

The explanatory `database_id` text in the plan is not a value to commit. Replace it through `apply_patch` with the observed 36-character UUID. Do not guess or reuse another database ID. If the database already exists, use `npx wrangler d1 list --json`, select the exact `ap-yoga-auth` record, and add its UUID.

- [ ] **Step 4: Apply local and production migrations**

Run:

```bash
npx wrangler d1 migrations apply ap-yoga-auth --local
npx wrangler d1 migrations apply ap-yoga-auth --remote
npx wrangler d1 execute ap-yoga-auth --remote --command "SELECT id, credential_version, updated_at FROM auth_credentials"
```

Expected: migration `0001_auth_credentials.sql` is applied; the final query succeeds with zero rows and prints no password hash.

- [ ] **Step 5: Run the complete pre-deploy verification suite**

Run:

```bash
npm run test:run
npm run typecheck
npm run typecheck:functions
npm run build
npm run test:e2e -- --list
git diff --check
if git grep -q -nE '(^|[^A-Za-z0-9_-])sk-(proj-)?[A-Za-z0-9_-]{12,}' -- . ':!package-lock.json'; then
  echo "credential_scan=MATCH"
  exit 1
else
  echo "credential_scan=NO_MATCH"
fi
```

Expected: all tests/typechecks/build pass, default E2E excludes production-auth tests, diff is clean, credential grep returns no matches. Only user-owned AP docs and Resource may be untracked.

- [ ] **Step 6: Commit the real binding and deploy**

```bash
git add wrangler.jsonc tests/unit/cloudflare-deployment.test.ts
git commit -m "2026-07-12 D1 인증 저장소 production binding"
npm run deploy:cloudflare
```

Expected: Pages Functions compile with `AUTH_DB` and Wrangler returns a production deployment URL. Canonical URL remains `https://ap-yoga-content-studio.pages.dev/`.

- [ ] **Step 7: Verify the live app-change flow**

In a fresh browser session:

1. Log in with the currently configured application password.
2. Open `/account/password` from Home.
3. Enter the current password and an operator-entered temporary 12+ character password twice.
4. Confirm redirect to `/login?password=changed` and the success status.
5. Confirm the old browser session and a second pre-existing session both receive `401` on `/api/auth/session`.
6. Confirm the old password is rejected and the temporary password logs in.
7. Confirm IndexedDB draft/image data remains present.
8. Confirm password/session responses are `Cache-Control: no-store` and no password/hash appears in browser assets, requests outside the HTTPS login/change bodies, or logs.

- [ ] **Step 8: Verify administrator reset and restore the final password**

Run `npm run auth:reset` in a TTY and enter the operator-selected final password twice. Verify:

1. secret uploads and deploy succeed before D1 deletion;
2. `SELECT id FROM auth_credentials` returns zero rows after reset;
3. the temporary app password is rejected;
4. the final password logs in;
5. every session created before reset is rejected.

Never include either password in command arguments, files, test fixtures, reports or Git.

- [ ] **Step 9: Push verified main and confirm remote/deployment parity**

```bash
git push origin main
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
npx wrangler pages deployment list --project-name ap-yoga-content-studio
```

Expected: local `HEAD`, `origin/main`, and latest production deployment source refer to the same final commit.

---

## Plan Self-Review Checklist

- Task 1 covers D1 schema, binding types, primary reads, secret fallback and fail-closed behavior.
- Task 2 covers PBKDF2 record creation, v2 session versioning, v1 compatibility and all existing auth paths.
- Task 3 covers the full password API boundary, current-password verification, scoped rate limit and cookie expiry.
- Task 4 covers protected UI, accessibility, success/error flows, routing and local-data preservation.
- Task 5 covers hidden administrator reset, failure-safe ordering, live login verification and operator docs.
- Task 6 covers actual resource creation, migrations, binding, full verification, app change, reset, deployment and GitHub parity.
- Function and type names are consistent across tasks: `readActiveCredential`, `changeCredential`, `createPasswordRecord`, `createSession`, `verifySession`, `handlePasswordChange`, `changePassword`.
