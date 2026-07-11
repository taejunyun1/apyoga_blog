# A.P YOGA Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a branded, single-account Cloudflare Pages login that protects the studio for 30 days per session without exposing credentials in source, browser bundles, logs, or tests.

**Architecture:** Cloudflare Pages Functions own credential verification, session signing, throttling, and route protection. The Vue app owns the branded login UI and fails closed until the live session endpoint succeeds; the existing PWA shell may cache static assets, but it never trusts cached authentication state.

**Tech Stack:** Vue 3, Pinia, Vue Router, Vitest, Playwright, Cloudflare Pages Functions, Web Crypto, Workers KV, Wrangler 4.110.0.

## Global Constraints

- Use one deployment-configured account; do not add registration, recovery, roles, or multiple users.
- Keep sessions for exactly 30 days (`Max-Age=2592000`).
- Use PBKDF2-HMAC-SHA-256 with a unique 128-bit salt, 600,000 iterations, and a 256-bit derived key.
- Use an HMAC-SHA-256 signed, versioned session payload.
- Set the session cookie to `HttpOnly; Secure; SameSite=Strict; Path=/`.
- Keep `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, and `SESSION_SECRET` in Cloudflare Pages secrets only.
- Never print, commit, log, or pass plaintext credentials as command-line arguments.
- Use a generic Korean invalid-login message and do not reveal which field failed.
- Limit five observed failed attempts per privacy-preserving rate-limit key within ten minutes using Workers KV; document KV eventual-consistency limits.
- Keep IndexedDB drafts and edited photos when logging out; remove service-worker caches.
- Fail closed when session verification is unavailable or invalid.
- Use unrelated fake credentials in every automated test.

## File Structure

- `functions/lib/env.ts`: shared Pages Function environment and minimal KV types.
- `functions/lib/auth.ts`: PBKDF2 verification, timing-safe comparison, session signing, and session verification.
- `functions/lib/http.ts`: cookies, JSON responses, origin/content-type checks, and client-key hashing.
- `functions/lib/rate-limit.ts`: KV-backed failed-attempt state.
- `functions/api/auth/login.ts`: login handler and Pages entrypoint.
- `functions/api/auth/session.ts`: session inspection handler and Pages entrypoint.
- `functions/api/auth/logout.ts`: logout handler and Pages entrypoint.
- `functions/_middleware.ts`: document redirect and private API rejection.
- `src/features/auth/auth-client.ts`: browser requests and cache clearing.
- `src/features/auth/auth-store.ts`: Pinia authentication state and actions.
- `src/features/auth/LogoutButton.vue`: shared logout control.
- `src/views/LoginView.vue`: branded login form.
- `scripts/provision-auth.mjs`: hidden password prompt, PBKDF2 material generation, and direct Wrangler secret registration.
- `public/_routes.json`: invoke Pages Functions only for documents and APIs, leaving immutable assets static.
- `tests/unit/auth-crypto.test.ts`: cryptographic behavior.
- `tests/unit/auth-http.test.ts`: cookie and request validation.
- `tests/unit/auth-functions.test.ts`: API handlers and throttling.
- `tests/unit/auth-middleware.test.ts`: route protection.
- `tests/component/login-view.test.ts`: form states and success navigation.
- `tests/component/auth-routing.test.ts`: startup gate and private route behavior.
- `tests/e2e/auth-flow.spec.ts`: deployed-style login, refresh, private route, logout, mobile, and desktop flow.

---

### Task 1: Authentication cryptography

**Files:**
- Create: `functions/lib/env.ts`
- Create: `functions/lib/auth.ts`
- Create: `tests/unit/auth-crypto.test.ts`
- Create: `tsconfig.functions.json`

**Interfaces:**
- Produces: `AuthEnv`, `verifyPassword(password, encoded)`, `createSession(username, secret, nowSeconds)`, `verifySession(token, username, secret, nowSeconds)`, `SESSION_SECONDS`, and `SESSION_COOKIE`.
- Consumes: standard Web Crypto available in Node 22 and Cloudflare Workers.

- [ ] **Step 1: Write the failing cryptography tests**

```ts
import { describe, expect, it } from "vitest"
import { createSession, SESSION_SECONDS, verifyPassword, verifySession } from "../../functions/lib/auth"

const encoded = "pbkdf2-sha256$1$AA$Lve95gjOVATpfV8EL5X4nxwjKHE"

describe("authentication cryptography", () => {
  it("accepts only the password matching a versioned PBKDF2 record", async () => {
    expect(await verifyPassword("test-password", encoded)).toBe(true)
    expect(await verifyPassword("wrong-password", encoded)).toBe(false)
  })

  it("accepts a signed session until the 30-day expiry", async () => {
    const now = 1_800_000_000
    const secret = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    const token = await createSession("studio-user", secret, now)
    expect(await verifySession(token, "studio-user", secret, now + SESSION_SECONDS - 1)).toBe(true)
    expect(await verifySession(token, "studio-user", secret, now + SESSION_SECONDS)).toBe(false)
  })

  it("rejects tampered and wrong-account sessions", async () => {
    const secret = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    const token = await createSession("studio-user", secret, 1_800_000_000)
    expect(await verifySession(`${token}x`, "studio-user", secret, 1_800_000_001)).toBe(false)
    expect(await verifySession(token, "other-user", secret, 1_800_000_001)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm run test:run -- tests/unit/auth-crypto.test.ts`

Expected: FAIL because `functions/lib/auth.ts` does not exist.

- [ ] **Step 3: Add the shared environment and minimal cryptographic implementation**

```ts
// functions/lib/env.ts
export interface RateLimitKV {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>
  delete(key: string): Promise<void>
}

export interface AuthEnv {
  AUTH_USERNAME: string
  AUTH_PASSWORD_HASH: string
  SESSION_SECRET: string
  AUTH_RATE_LIMIT: RateLimitKV
}

export interface PagesContext<Env> {
  request: Request
  env: Env
  next(): Promise<Response>
}

export type PagesHandler<Env> = (context: PagesContext<Env>) => Response | Promise<Response>
```

```ts
// functions/lib/auth.ts
export const SESSION_COOKIE = "ap_yoga_session"
export const SESSION_SECONDS = 30 * 24 * 60 * 60
const encoder = new TextEncoder()

function decode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}

function encode(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, iterationsText, saltText, hashText] = encoded.split("$")
  const iterations = Number(iterationsText)
  if (algorithm !== "pbkdf2-sha256" || iterations !== 600_000 || password.length > 256) return false
  try {
    const salt = decode(saltText)
    const expected = decode(hashText)
    if (salt.length !== 16 || expected.length !== 32) return false
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"])
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256)
    return equal(new Uint8Array(bits), expected)
  } catch {
    return false
  }
}

async function hmac(payload: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", decode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)))
}

export async function createSession(username: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const payload = encode(encoder.encode(JSON.stringify({ v: 1, sub: username, iat: nowSeconds, exp: nowSeconds + SESSION_SECONDS })))
  return `${payload}.${encode(await hmac(payload, secret))}`
}

export async function verifySession(token: string, username: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const [payload, signature, extra] = token.split(".")
  if (!payload || !signature || extra) return false
  try {
    if (!equal(decode(signature), await hmac(payload, secret))) return false
    const value = JSON.parse(new TextDecoder().decode(decode(payload))) as { v?: number; sub?: string; iat?: number; exp?: number }
    return value.v === 1 && value.sub === username && Number.isInteger(value.iat) && Number.isInteger(value.exp) && value.iat! <= nowSeconds && value.exp! > nowSeconds && value.exp! - value.iat! === SESSION_SECONDS
  } catch {
    return false
  }
}
```

Add a focused Functions configuration so Pages code type-checks independently from Vue DOM augmentation:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["functions/**/*.ts"]
}
```

- [ ] **Step 4: Replace the one-iteration fixture with a deterministic 600,000-iteration test fixture and run GREEN**

Generate the fixture inside the test with Web Crypto so no production credential appears:

```ts
async function testRecord(password: string): Promise<string> {
  const salt = new Uint8Array(16)
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"])
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 600_000 }, key, 256))
  const b64 = (value: Uint8Array) => Buffer.from(value).toString("base64url")
  return `pbkdf2-sha256$600000$${b64(salt)}$${b64(bits)}`
}
```

Run: `npm run test:run -- tests/unit/auth-crypto.test.ts && npx tsc -p tsconfig.functions.json --noEmit`

Expected: PASS with three cryptography tests and zero type errors.

- [ ] **Step 5: Commit**

```bash
git add functions/lib/env.ts functions/lib/auth.ts tests/unit/auth-crypto.test.ts tsconfig.functions.json
git commit -m "feat: add authentication cryptography"
```

### Task 2: HTTP boundaries and session endpoints

**Files:**
- Create: `functions/lib/http.ts`
- Create: `functions/api/auth/session.ts`
- Create: `functions/api/auth/logout.ts`
- Create: `tests/unit/auth-http.test.ts`
- Modify: `tests/unit/auth-functions.test.ts`

**Interfaces:**
- Consumes: `AuthEnv`, `SESSION_COOKIE`, `SESSION_SECONDS`, and `verifySession` from Task 1.
- Produces: `cookieValue`, `sessionCookie`, `expiredSessionCookie`, `isSameOriginJson`, `json`, `handleSession`, and `handleLogout`.

- [ ] **Step 1: Write failing HTTP and endpoint tests**

```ts
import { describe, expect, it } from "vitest"
import { expiredSessionCookie, isSameOriginJson, sessionCookie } from "../../functions/lib/http"

describe("authentication HTTP boundary", () => {
  it("creates a hardened 30-day cookie", () => {
    expect(sessionCookie("token")).toBe("ap_yoga_session=token; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Strict")
  })

  it("expires the same cookie on logout", () => {
    expect(expiredSessionCookie()).toContain("ap_yoga_session=; Max-Age=0; Path=/")
  })

  it("accepts only same-origin JSON mutations", () => {
    const valid = new Request("https://studio.example/api/auth/logout", { method: "POST", headers: { Origin: "https://studio.example", "Content-Type": "application/json" } })
    const crossOrigin = new Request("https://studio.example/api/auth/logout", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" } })
    expect(isSameOriginJson(valid)).toBe(true)
    expect(isSameOriginJson(crossOrigin)).toBe(false)
  })
})
```

Add endpoint cases to `tests/unit/auth-functions.test.ts`: unauthenticated session returns `401`, valid cookie returns `200`, same-origin logout returns `204` with an expired cookie, and cross-origin logout returns `403`.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm run test:run -- tests/unit/auth-http.test.ts tests/unit/auth-functions.test.ts`

Expected: FAIL because the helpers and handlers do not exist.

- [ ] **Step 3: Implement HTTP helpers and endpoint handlers**

```ts
// functions/lib/http.ts
import { SESSION_COOKIE, SESSION_SECONDS } from "./auth"

export function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } })
}

export function cookieValue(request: Request, name = SESSION_COOKIE): string | null {
  const match = request.headers.get("Cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${SESSION_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`
}

export function expiredSessionCookie(): string {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`
}

export function isSameOriginJson(request: Request): boolean {
  return request.headers.get("Origin") === new URL(request.url).origin && request.headers.get("Content-Type")?.split(";", 1)[0] === "application/json"
}
```

```ts
// functions/api/auth/session.ts
import { verifySession } from "../../lib/auth"
import type { AuthEnv, PagesHandler } from "../../lib/env"
import { cookieValue, json } from "../../lib/http"

export async function handleSession(request: Request, env: AuthEnv): Promise<Response> {
  const token = cookieValue(request)
  const authenticated = Boolean(token && env.AUTH_USERNAME && env.SESSION_SECRET && await verifySession(token, env.AUTH_USERNAME, env.SESSION_SECRET))
  return authenticated ? json({ authenticated: true }) : json({ authenticated: false }, 401)
}

export const onRequestGet: PagesHandler<AuthEnv> = ({ request, env }) => handleSession(request, env)
```

```ts
// functions/api/auth/logout.ts
import type { AuthEnv, PagesHandler } from "../../lib/env"
import { expiredSessionCookie, isSameOriginJson, json } from "../../lib/http"

export async function handleLogout(request: Request): Promise<Response> {
  if (!isSameOriginJson(request)) return json({ message: "요청을 확인해 주세요." }, 403)
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", "Set-Cookie": expiredSessionCookie() } })
}

export const onRequestPost: PagesHandler<AuthEnv> = ({ request }) => handleLogout(request)
```

- [ ] **Step 4: Run GREEN and type-check**

Run: `npm run test:run -- tests/unit/auth-http.test.ts tests/unit/auth-functions.test.ts && npm run typecheck`

Expected: PASS with cookie, origin, session, and logout cases.

- [ ] **Step 5: Commit**

```bash
git add functions/lib/http.ts functions/api/auth/session.ts functions/api/auth/logout.ts tests/unit/auth-http.test.ts tests/unit/auth-functions.test.ts
git commit -m "feat: add session and logout endpoints"
```

### Task 3: Login handler and KV throttling

**Files:**
- Create: `functions/lib/rate-limit.ts`
- Create: `functions/api/auth/login.ts`
- Modify: `tests/unit/auth-functions.test.ts`

**Interfaces:**
- Consumes: `AuthEnv`, `verifyPassword`, `createSession`, `isSameOriginJson`, `json`, and `sessionCookie`.
- Produces: `rateLimitKey(request, secret)`, `readFailures`, `recordFailure`, `clearFailures`, and `handleLogin(request, env)`.

- [ ] **Step 1: Add failing login and throttling tests**

Use an in-memory `RateLimitKV` fake and a test-generated PBKDF2 record. Cover:

```ts
it("sets a hardened cookie for matching fake credentials", async () => {
  const response = await handleLogin(loginRequest("studio-user", "test-password"), env)
  expect(response.status).toBe(204)
  expect(response.headers.get("Set-Cookie")).toContain("Max-Age=2592000")
})

it("returns one generic message for either invalid field", async () => {
  const wrongUser = await handleLogin(loginRequest("wrong-user", "test-password"), env)
  const wrongPassword = await handleLogin(loginRequest("studio-user", "wrong-password"), env)
  expect(await wrongUser.json()).toEqual(await wrongPassword.json())
})

it("locks the sixth observed failure for ten minutes", async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) await handleLogin(loginRequest("wrong-user", "wrong-password"), env)
  expect((await handleLogin(loginRequest("wrong-user", "wrong-password"), env)).status).toBe(429)
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:run -- tests/unit/auth-functions.test.ts`

Expected: FAIL because `handleLogin` and rate-limit functions do not exist.

- [ ] **Step 3: Implement privacy-preserving rate-limit keys and the login handler**

```ts
// functions/lib/rate-limit.ts
import type { AuthEnv } from "./env"

const WINDOW_SECONDS = 600
const encoder = new TextEncoder()

export async function rateLimitKey(request: Request, secret: string): Promise<string> {
  const address = request.headers.get("CF-Connecting-IP") ?? "unknown"
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`login:${address}`)))
  return `login:${Array.from(signature).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

export async function readFailures(env: AuthEnv, key: string): Promise<number> {
  return Number(await env.AUTH_RATE_LIMIT.get(key) ?? "0") || 0
}

export async function recordFailure(env: AuthEnv, key: string, failures: number): Promise<void> {
  await env.AUTH_RATE_LIMIT.put(key, String(failures + 1), { expirationTtl: WINDOW_SECONDS })
}

export async function clearFailures(env: AuthEnv, key: string): Promise<void> {
  await env.AUTH_RATE_LIMIT.delete(key)
}
```

```ts
// functions/api/auth/login.ts
import { createSession, verifyPassword } from "../../lib/auth"
import type { AuthEnv, PagesHandler } from "../../lib/env"
import { isSameOriginJson, json, sessionCookie } from "../../lib/http"
import { clearFailures, rateLimitKey, readFailures, recordFailure } from "../../lib/rate-limit"

const INVALID = { message: "아이디 또는 비밀번호를 확인해 주세요." }

export async function handleLogin(request: Request, env: AuthEnv): Promise<Response> {
  if (!isSameOriginJson(request)) return json({ message: "요청을 확인해 주세요." }, 403)
  if (!env.AUTH_USERNAME || !env.AUTH_PASSWORD_HASH || !env.SESSION_SECRET || !env.AUTH_RATE_LIMIT) return json({ message: "로그인을 처리하지 못했어요. 잠시 후 다시 시도해 주세요." }, 500)
  const key = await rateLimitKey(request, env.SESSION_SECRET)
  const failures = await readFailures(env, key)
  if (failures >= 5) return json({ message: "로그인 시도가 많아요. 10분 후 다시 시도해 주세요." }, 429)
  let body: { username?: unknown; password?: unknown }
  try { body = await request.json() as typeof body } catch { return json({ message: "요청을 확인해 주세요." }, 400) }
  const username = typeof body.username === "string" ? body.username : ""
  const password = typeof body.password === "string" ? body.password : ""
  const passwordValid = await verifyPassword(password, env.AUTH_PASSWORD_HASH)
  const valid = username === env.AUTH_USERNAME && passwordValid
  if (!valid) {
    await recordFailure(env, key, failures)
    return json(INVALID, 401)
  }
  await clearFailures(env, key)
  const token = await createSession(env.AUTH_USERNAME, env.SESSION_SECRET)
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", "Set-Cookie": sessionCookie(token) } })
}

export const onRequestPost: PagesHandler<AuthEnv> = ({ request, env }) => handleLogin(request, env)
```

- [ ] **Step 4: Run GREEN and the full Functions unit set**

Run: `npm run test:run -- tests/unit/auth-crypto.test.ts tests/unit/auth-http.test.ts tests/unit/auth-functions.test.ts`

Expected: PASS; verify the fake KV keys never contain the fake raw IP.

- [ ] **Step 5: Commit**

```bash
git add functions/lib/rate-limit.ts functions/api/auth/login.ts tests/unit/auth-functions.test.ts
git commit -m "feat: add rate-limited login endpoint"
```

### Task 4: Pages middleware route protection

**Files:**
- Create: `functions/_middleware.ts`
- Create: `public/_routes.json`
- Create: `tests/unit/auth-middleware.test.ts`

**Interfaces:**
- Consumes: `AuthEnv`, `cookieValue`, and `verifySession`.
- Produces: `protectRequest(request, env, next)` and the root Pages `onRequest` middleware.

- [ ] **Step 1: Write failing middleware tests**

Cover the exact behaviors:

```ts
it("allows login and authentication endpoints without a session", async () => {
  expect((await protectRequest(new Request("https://studio.example/login"), env, next)).status).toBe(200)
  expect((await protectRequest(new Request("https://studio.example/api/auth/login"), env, next)).status).toBe(200)
})

it("redirects private documents and rejects private APIs", async () => {
  expect((await protectRequest(new Request("https://studio.example/studio/draft-1"), env, next)).status).toBe(302)
  expect((await protectRequest(new Request("https://studio.example/api/ai"), env, next)).status).toBe(401)
})

it("passes a valid signed session to static routing", async () => {
  const request = new Request("https://studio.example/", { headers: { Cookie: `ap_yoga_session=${token}` } })
  expect((await protectRequest(request, env, next)).status).toBe(200)
})
```

- [ ] **Step 2: Run the middleware test and verify RED**

Run: `npm run test:run -- tests/unit/auth-middleware.test.ts`

Expected: FAIL because the middleware does not exist.

- [ ] **Step 3: Implement the middleware and Functions routing manifest**

```ts
// functions/_middleware.ts
import { verifySession } from "./lib/auth"
import type { AuthEnv, PagesHandler } from "./lib/env"
import { cookieValue, json } from "./lib/http"

const PUBLIC = new Set(["/login", "/api/auth/login", "/api/auth/session", "/api/auth/logout"])

export async function protectRequest(request: Request, env: AuthEnv, next: () => Promise<Response>): Promise<Response> {
  const url = new URL(request.url)
  if (PUBLIC.has(url.pathname)) return next()
  const token = cookieValue(request)
  if (token && env.AUTH_USERNAME && env.SESSION_SECRET && await verifySession(token, env.AUTH_USERNAME, env.SESSION_SECRET)) return next()
  if (url.pathname.startsWith("/api/")) return json({ message: "로그인이 필요해요." }, 401)
  const login = new URL("/login", url)
  login.searchParams.set("next", `${url.pathname}${url.search}`)
  return Response.redirect(login, 302)
}

export const onRequest: PagesHandler<AuthEnv> = ({ request, env, next }) => protectRequest(request, env, next)
```

```json
{
  "version": 1,
  "include": ["/", "/login", "/studio/*", "/api/*"],
  "exclude": []
}
```

- [ ] **Step 4: Run GREEN and verify the route manifest is copied by Vite**

Run: `npm run test:run -- tests/unit/auth-middleware.test.ts && npm run build && test -f dist/_routes.json`

Expected: middleware tests PASS, build exits 0, and `dist/_routes.json` exists.

- [ ] **Step 5: Commit**

```bash
git add functions/_middleware.ts public/_routes.json tests/unit/auth-middleware.test.ts
git commit -m "feat: protect private Pages routes"
```

### Task 5: Client authentication state and router gate

**Files:**
- Create: `src/features/auth/auth-client.ts`
- Create: `src/features/auth/auth-store.ts`
- Create: `src/views/LoginView.vue`
- Create: `tests/component/auth-routing.test.ts`
- Modify: `src/app/router.ts`
- Modify: `src/app/App.vue`

**Interfaces:**
- Consumes: the three authentication endpoints from Tasks 2 and 3.
- Produces: `AuthClient`, `BrowserAuthClient`, `useAuthStore`, public `/login`, and a private-route guard.

- [ ] **Step 1: Write failing authentication-state and routing tests**

```ts
it("does not render a private view before the session check resolves", async () => {
  let resolveSession!: (value: boolean) => void
  configureAuthClient({ session: () => new Promise((resolve) => { resolveSession = resolve }), login: vi.fn(), logout: vi.fn() })
  const wrapper = mount(App, { global: { plugins: [pinia, router] } })
  expect(wrapper.text()).toContain("로그인 상태 확인 중")
  expect(wrapper.text()).not.toContain("새 글 만들기")
  resolveSession(false)
  await flushPromises()
  expect(router.currentRoute.value.name).toBe("login")
})
```

Also test that an authenticated session reaches `/`, an unauthenticated direct `/studio/draft-1` visit preserves the `next` query, and a network failure fails closed.

- [ ] **Step 2: Run the routing test and verify RED**

Run: `npm run test:run -- tests/component/auth-routing.test.ts`

Expected: FAIL because the auth client, store, login route, and splash state do not exist.

- [ ] **Step 3: Implement the client and store**

```ts
// src/features/auth/auth-client.ts
export interface AuthClient {
  session(): Promise<boolean>
  login(username: string, password: string): Promise<void>
  logout(): Promise<void>
}

async function message(response: Response): Promise<string> {
  return response.json().then((value: { message?: string }) => value.message ?? "요청을 처리하지 못했어요.").catch(() => "요청을 처리하지 못했어요.")
}

export class BrowserAuthClient implements AuthClient {
  async session() { return fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" }).then((response) => response.ok) }
  async login(username: string, password: string) {
    const response = await fetch("/api/auth/login", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) })
    if (!response.ok) throw new Error(await message(response))
  }
  async logout() {
    const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" })
    if (!response.ok) throw new Error(await message(response))
  }
}
```

```ts
// src/features/auth/auth-store.ts
import { defineStore } from "pinia"
import { ref } from "vue"
import { BrowserAuthClient, type AuthClient } from "./auth-client"

let client: AuthClient = new BrowserAuthClient()
export const configureAuthClient = (value: AuthClient) => { client = value }

export const useAuthStore = defineStore("auth", () => {
  const status = ref<"checking" | "authenticated" | "unauthenticated">("checking")
  async function check() {
    status.value = "checking"
    try { status.value = await client.session() ? "authenticated" : "unauthenticated" }
    catch { status.value = "unauthenticated" }
    return status.value === "authenticated"
  }
  async function login(username: string, password: string) { await client.login(username, password); status.value = "authenticated" }
  async function logout() { await client.logout(); status.value = "unauthenticated" }
  return { status, check, login, logout }
})
```

Create the route and guard with the complete router structure:

```ts
import { createRouter, createWebHistory } from "vue-router"
import { useAuthStore } from "@/features/auth/auth-store"
import HomeView from "@/views/HomeView.vue"
import LoginView from "@/views/LoginView.vue"
import StudioView from "@/views/StudioView.vue"

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: LoginView, meta: { public: true } },
    { path: "/", name: "home", component: HomeView },
    { path: "/studio/:draftId", name: "studio", component: StudioView }
  ],
  scrollBehavior: () => ({ top: 0 })
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (auth.status === "checking") await auth.check()
  if (to.meta.public) return auth.status === "authenticated" ? { name: "home" } : true
  if (auth.status !== "authenticated") return { name: "login", query: { next: to.fullPath } }
  return true
})

export default router
```

Create a minimal route target that Task 6 replaces with the approved branded form:

```vue
<template><main class="auth-page"><p role="status">로그인이 필요해요.</p></main></template>
```

Update `src/app/App.vue` to keep private content out of the DOM while checking:

```vue
<script setup lang="ts">
import { useAuthStore } from "@/features/auth/auth-store"
const auth = useAuthStore()
</script>

<template>
  <main v-if="auth.status === 'checking'" class="auth-page"><p role="status">로그인 상태 확인 중…</p></main>
  <RouterView v-else />
</template>
```

- [ ] **Step 4: Run GREEN and the existing app-shell tests**

Run: `npm run test:run -- tests/component/auth-routing.test.ts tests/component/app-shell.test.ts`

Expected: PASS with no private content before session verification.

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/auth-client.ts src/features/auth/auth-store.ts src/views/LoginView.vue src/app/router.ts src/app/App.vue tests/component/auth-routing.test.ts
git commit -m "feat: gate the studio behind live session checks"
```

### Task 6: Branded login and logout UI

**Files:**
- Modify: `src/views/LoginView.vue`
- Create: `src/features/auth/LogoutButton.vue`
- Create: `tests/component/login-view.test.ts`
- Modify: `src/views/HomeView.vue`
- Modify: `src/views/StudioView.vue`
- Modify: `src/app/styles.css`

**Interfaces:**
- Consumes: `useAuthStore`, the login route `next` query, and the existing A.P YOGA design tokens.
- Produces: accessible login form and shared logout action.

- [ ] **Step 1: Write failing component tests**

Cover required states with fake credentials only:

```ts
it("submits the branded form and follows the safe next route", async () => {
  const login = vi.fn().mockResolvedValue(undefined)
  configureAuthClient({ session: vi.fn().mockResolvedValue(false), login, logout: vi.fn() })
  const wrapper = mount(LoginView, { global: { plugins: [pinia, router] } })
  await wrapper.get("[name=username]").setValue("studio-user")
  await wrapper.get("[name=password]").setValue("test-password")
  await wrapper.get("form").trigger("submit")
  await flushPromises()
  expect(login).toHaveBeenCalledWith("studio-user", "test-password")
})
```

Also test required fields, loading disables submission, a `401`-style error is announced with `role="alert"`, a lockout message is rendered unchanged, and `next=https://evil.example` falls back to `/`.

- [ ] **Step 2: Run the component test and verify RED**

Run: `npm run test:run -- tests/component/login-view.test.ts`

Expected: FAIL because the login view and logout control do not exist.

- [ ] **Step 3: Implement the branded login page and shared logout control**

Replace the minimal route target with this complete semantic form:

```vue
<script setup lang="ts">
import { ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import { useAuthStore } from "@/features/auth/auth-store"

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const username = ref("")
const password = ref("")
const busy = ref(false)
const error = ref<string | null>(null)

async function submit() {
  busy.value = true
  error.value = null
  try {
    await auth.login(username.value, password.value)
    const requested = Array.isArray(route.query.next) ? route.query.next[0] : route.query.next
    const destination = typeof requested === "string" && requested.startsWith("/") && !requested.startsWith("//") ? requested : "/"
    await router.replace(destination)
  } catch (reason) {
    password.value = ""
    error.value = reason instanceof Error ? reason.message : "로그인을 처리하지 못했어요."
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-card" aria-labelledby="login-heading">
      <header class="auth-brand">
        <img src="/app-icon.svg" alt="" />
        <p>A.P YOGA</p>
        <h1 id="login-heading">Content Studio 로그인</h1>
        <span id="login-description">수련의 기록을 안전하게 이어가세요.</span>
      </header>
      <form aria-describedby="login-description" @submit.prevent="submit">
        <label class="auth-field" for="auth-username">
          <span>아이디</span>
          <input id="auth-username" v-model="username" name="username" autocomplete="username" required :disabled="busy" />
        </label>
        <label class="auth-field" for="auth-password">
          <span>비밀번호</span>
          <input id="auth-password" v-model="password" name="password" type="password" autocomplete="current-password" required :disabled="busy" />
        </label>
        <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
        <button class="primary-action" type="submit" :disabled="busy">{{ busy ? "로그인 중…" : "로그인" }}</button>
      </form>
    </section>
  </main>
</template>
```

Create the shared logout control:

```vue
<script setup lang="ts">
import { ref } from "vue"
import { useAuthStore } from "./auth-store"
const emit = defineEmits<{ error: [message: string] }>()
const auth = useAuthStore()
const busy = ref(false)
async function logout() {
  busy.value = true
  try {
    await auth.logout()
    if ("caches" in window) await Promise.all((await caches.keys()).map((name) => caches.delete(name)))
    window.location.assign("/login")
  } catch {
    emit("error", "로그아웃하지 못했어요. 다시 시도해 주세요.")
  } finally {
    busy.value = false
  }
}
</script>

<template><button class="logout-button" type="button" :disabled="busy" @click="logout">{{ busy ? "로그아웃 중…" : "로그아웃" }}</button></template>
```

Place the logout control in the home brand header and studio header. Add focused CSS blocks under `.auth-page`, `.auth-card`, `.auth-brand`, `.auth-field`, `.auth-error`, and `.logout-button`; preserve the existing `--ap-*` tokens, 44px minimum controls, mobile-first width, and visible focus ring.

Use these concrete layout rules and add only responsive refinements needed by the rendered check:

```css
.auth-page { display: grid; min-height: 100dvh; place-items: center; padding: 24px 20px; background: var(--ap-bg); }
.auth-card { width: min(100%, 430px); border: 1px solid var(--ap-border); border-radius: 22px; background: var(--ap-surface); padding: 32px 26px; box-shadow: 0 18px 50px rgb(78 55 32 / 10%); }
.auth-brand { display: grid; justify-items: center; margin-bottom: 30px; text-align: center; }
.auth-brand img { width: 68px; height: 68px; }
.auth-brand p { margin: 12px 0 2px; color: #8b572a; font-weight: 760; letter-spacing: .08em; }
.auth-brand h1 { margin: 0; font-size: 1.65rem; letter-spacing: -.035em; }
.auth-brand span { margin-top: 9px; color: var(--ap-muted); font-size: .9rem; }
.auth-card form { display: grid; gap: 18px; }
.auth-field { display: grid; gap: 8px; font-size: .9rem; font-weight: 680; }
.auth-field input { min-height: 52px; border: 1px solid var(--ap-border); border-radius: var(--ap-control-radius); background: #fff; padding: 0 14px; }
.auth-error { margin: 0; border-radius: 10px; background: #fff1ef; padding: 12px; color: var(--ap-error); font-size: .86rem; line-height: 1.5; }
.logout-button { min-height: 44px; border: 1px solid var(--ap-border); border-radius: 10px; background: #fff; padding: 0 13px; cursor: pointer; font-weight: 650; }
```

- [ ] **Step 4: Run GREEN and visual component regression tests**

Run: `npm run test:run -- tests/component/login-view.test.ts tests/component/app-shell.test.ts tests/component/studio-generation-flow.test.ts`

Expected: PASS with accessible form labels and existing studio behavior unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/views/LoginView.vue src/features/auth/LogoutButton.vue src/views/HomeView.vue src/views/StudioView.vue src/app/styles.css tests/component/login-view.test.ts
git commit -m "feat: add branded login and logout experience"
```

### Task 7: PWA cache rules and build verification

**Files:**
- Modify: `vite.config.ts`
- Modify: `tests/unit/pwa-build.test.ts`
- Modify: `tests/unit/cloudflare-deployment.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: the session gate and logout cache clearing from Tasks 5 and 6.
- Produces: a build that excludes authentication APIs from navigation fallback and deploys Functions with the existing Pages command.

- [ ] **Step 1: Add failing PWA and deployment assertions**

Add assertions that `vite.config.ts` contains a `navigateFallbackDenylist` matching `/api/`, `public/_routes.json` exists, the session client uses `cache: "no-store"`, and the deploy command still targets the production `master` branch.

```ts
expect(configSource).toContain("navigateFallbackDenylist")
expect(configSource).toContain("/^\\/api\\//")
expect(JSON.parse(readFileSync("public/_routes.json", "utf8")).include).toContain("/api/*")
expect(authClientSource).toContain('cache: "no-store"')
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm run test:run -- tests/unit/pwa-build.test.ts tests/unit/cloudflare-deployment.test.ts`

Expected: FAIL because the PWA denylist and auth build assertions are absent.

- [ ] **Step 3: Add the PWA rule and Functions type-check script**

```ts
// inside VitePWA workbox
workbox: {
  globIgnores: ["**/mediapipe/**"],
  navigateFallbackDenylist: [/^\/api\//]
}
```

Add `"typecheck:functions": "tsc -p tsconfig.functions.json --noEmit"` and update `build` to run both the Vue and Functions type checks before Vite. Do not add a service-worker runtime cache for `/api/auth/*`.

- [ ] **Step 4: Run GREEN, full tests, and build**

Run: `npm run test:run && npm run build`

Expected: all tests PASS; the build emits `dist/_routes.json`, `dist/sw.js`, and no credential strings.

Run the credential scan with names only, never values:

```bash
rg -n "AUTH_PASSWORD_HASH|SESSION_SECRET" dist && exit 1 || true
```

Expected: no matches in `dist`.

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts tests/unit/pwa-build.test.ts tests/unit/cloudflare-deployment.test.ts package.json
git commit -m "chore: make authentication cache-safe"
```

### Task 8: Secure provisioning workflow and Cloudflare binding

**Files:**
- Create: `scripts/provision-auth.mjs`
- Create: `tests/unit/auth-provision-script.test.ts`
- Modify: `package.json`
- Modify by Wrangler: `wrangler.jsonc`

**Interfaces:**
- Consumes: Wrangler OAuth for the existing `ap-yoga-content-studio` project.
- Produces: `AUTH_RATE_LIMIT` KV binding plus three Cloudflare Pages secrets without writing their values to disk or stdout.

- [ ] **Step 1: Write a failing static safety test for the provisioning script**

```ts
it("provisions secrets through stdin without CLI secret arguments", () => {
  const source = readFileSync("scripts/provision-auth.mjs", "utf8")
  expect(source).toContain('"pages", "secret", "put"')
  expect(source).toContain("input: `${value}\\n`")
  expect(source).not.toContain("console.log(password")
  expect(source).not.toContain("AUTH_SETUP_PASSWORD")
})
```

- [ ] **Step 2: Run the safety test and verify RED**

Run: `npm run test:run -- tests/unit/auth-provision-script.test.ts`

Expected: FAIL because the provisioning script does not exist.

- [ ] **Step 3: Implement a non-echoing provisioning script**

The script must:

1. require an interactive TTY;
2. prompt visibly for the username;
3. read the password in raw mode while rendering `*` instead of characters;
4. generate 16 random salt bytes;
5. derive 32 bytes with `pbkdf2Sync(password, salt, 600_000, 32, "sha256")`;
6. serialize `pbkdf2-sha256$600000$<salt-base64url>$<hash-base64url>`;
7. generate a 32-byte base64url session secret;
8. call Wrangler separately for `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, and `SESSION_SECRET` using `spawnSync` with the secret value plus one newline on standard input and inherited stdout/stderr;
9. overwrite the in-memory password variable before exit;
10. print only secret names and success/failure status.

Use this exact Wrangler argument array:

```js
["wrangler", "pages", "secret", "put", name, "--project-name", "ap-yoga-content-studio"]
```

Implement the complete script with this structure:

```js
import { spawnSync } from "node:child_process"
import { pbkdf2Sync, randomBytes } from "node:crypto"
import readline from "node:readline"

if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("대화형 터미널에서 실행해 주세요.")

function readLine(prompt) {
  return new Promise((resolve) => {
    const input = readline.createInterface({ input: process.stdin, output: process.stdout })
    input.question(prompt, (value) => { input.close(); resolve(value) })
  })
}

function readHidden(prompt) {
  process.stdout.write(prompt)
  readline.emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  return new Promise((resolve, reject) => {
    let value = ""
    const finish = () => {
      process.stdin.off("keypress", onKey)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdout.write("\n")
    }
    const onKey = (text, key) => {
      if (key.ctrl && key.name === "c") { finish(); reject(new Error("취소되었습니다.")); return }
      if (key.name === "return") { finish(); resolve(value); return }
      if (key.name === "backspace") {
        if (value.length > 0) { value = value.slice(0, -1); process.stdout.write("\b \b") }
        return
      }
      if (text && !key.ctrl && !key.meta) { value += text; process.stdout.write("*") }
    }
    process.stdin.on("keypress", onKey)
  })
}

function putSecret(name, value) {
  const result = spawnSync("npx", ["wrangler", "pages", "secret", "put", name, "--project-name", "ap-yoga-content-studio"], {
    input: `${value}\n`,
    stdio: ["pipe", "inherit", "inherit"],
    encoding: "utf8"
  })
  if (result.status !== 0) throw new Error(`${name} 등록에 실패했습니다.`)
  process.stdout.write(`${name} 등록 완료\n`)
}

const username = String(await readLine("아이디: ")).trim()
let password = String(await readHidden("비밀번호: "))
if (!username || !password) throw new Error("아이디와 비밀번호를 입력해 주세요.")
const salt = randomBytes(16)
const derived = pbkdf2Sync(password, salt, 600_000, 32, "sha256")
const passwordHash = `pbkdf2-sha256$600000$${salt.toString("base64url")}$${derived.toString("base64url")}`
const sessionSecret = randomBytes(32).toString("base64url")
putSecret("AUTH_USERNAME", username)
putSecret("AUTH_PASSWORD_HASH", passwordHash)
putSecret("SESSION_SECRET", sessionSecret)
password = "\0".repeat(password.length)
```

Add `"auth:provision": "node scripts/provision-auth.mjs"` to `package.json`.

- [ ] **Step 4: Run GREEN, create KV, and register secrets interactively**

Run: `npm run test:run -- tests/unit/auth-provision-script.test.ts`

Expected: PASS.

Create and bind the KV namespace with Wrangler's config updater, which avoids copying an unknown resource ID manually:

```bash
npx wrangler kv namespace create ap-yoga-auth-rate-limit --binding AUTH_RATE_LIMIT --update-config
```

Expected: Wrangler creates the namespace and adds a `kv_namespaces` entry named `AUTH_RATE_LIMIT` to `wrangler.jsonc`.

Run interactively in the user's terminal:

```bash
npm run auth:provision
```

Expected: three success messages naming only `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, and `SESSION_SECRET`. Do not capture terminal output containing user keystrokes, and do not automate the password entry through command arguments.

Verify names only:

```bash
npx wrangler pages secret list --project-name ap-yoga-content-studio
```

Expected: the three secret names are listed; no values are returned.

- [ ] **Step 5: Commit code and generated binding metadata**

```bash
git add scripts/provision-auth.mjs tests/unit/auth-provision-script.test.ts package.json wrangler.jsonc
git commit -m "chore: provision Cloudflare authentication safely"
```

### Task 9: End-to-end verification and production deployment

**Files:**
- Create: `tests/e2e/auth-flow.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: the completed login system, production Pages secrets, KV binding, and existing photo-to-content workflow.
- Produces: repeatable authentication E2E coverage and a verified production deployment.

- [ ] **Step 1: Write the failing E2E authentication specification using fake local credentials**

Add a Playwright project or environment override for `wrangler pages dev dist` with test-only `.dev.vars` created outside the repository. The spec must verify:

Use this environment switch in `playwright.config.ts` so the existing Vite E2E behavior remains the default:

```ts
import { defineConfig, devices } from "@playwright/test"

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  expect: { timeout: 30_000 },
  use: {
    baseURL: externalBaseUrl ?? "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    { name: "mobile-chromium", use: { ...devices["iPhone 13"], browserName: "chromium", viewport: { width: 390, height: 844 } } },
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }
  ],
  webServer: externalBaseUrl ? undefined : {
    command: "npm run dev -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 120_000
  }
})
```

```ts
test("protects, authenticates, refreshes, and logs out", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel("아이디").fill("studio-user")
  await page.getByLabel("비밀번호").fill("wrong-password")
  await page.getByRole("button", { name: "로그인" }).click()
  await expect(page.getByRole("alert")).toContainText("아이디 또는 비밀번호")
  await page.getByLabel("비밀번호").fill("test-password")
  await page.getByRole("button", { name: "로그인" }).click()
  await expect(page.getByRole("button", { name: "새 글 만들기" })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("button", { name: "새 글 만들기" })).toBeVisible()
  await page.getByRole("button", { name: "로그아웃" }).click()
  await expect(page).toHaveURL(/\/login/)
  await page.goto("/")
  await expect(page).toHaveURL(/\/login/)
})
```

Add a mobile assertion for no horizontal overflow and a desktop run that continues through the existing photo-to-two-channel generation flow after login.

- [ ] **Step 2: Run the new E2E spec before starting the Functions dev server and verify RED**

Run: `npx playwright test tests/e2e/auth-flow.spec.ts`

Expected: FAIL because the configured local Functions server and fake secrets are not running.

- [ ] **Step 3: Run local Pages Functions with ephemeral fake secrets and verify GREEN**

Create the temporary fake environment with a deterministic test-only PBKDF2 record; never use the production credential:

```bash
mkdir -p /tmp/ap-yoga-auth-qa
node --input-type=module -e 'import { pbkdf2Sync } from "node:crypto"; import { writeFileSync } from "node:fs"; const salt = Buffer.alloc(16); const hash = pbkdf2Sync("test-password", salt, 600000, 32, "sha256"); const record = `pbkdf2-sha256$600000$${salt.toString("base64url")}$${hash.toString("base64url")}`; writeFileSync("/tmp/ap-yoga-auth-qa/.dev.vars", `AUTH_USERNAME=studio-user\nAUTH_PASSWORD_HASH=${record}\nSESSION_SECRET=${Buffer.alloc(32).toString("base64url")}\n`, { mode: 0o600 })'
```

Pass that file to the local Pages server:

```bash
npm run build
npx wrangler pages dev dist --port 4173 --env-file /tmp/ap-yoga-auth-qa/.dev.vars
```

Run: `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 npx playwright test tests/e2e/auth-flow.spec.ts`

Expected: desktop and mobile auth flows PASS with zero application runtime errors.

- [ ] **Step 4: Run the complete verification suite**

```bash
npm run test:run
npm run build
npm run test:e2e
git diff --check
```

Expected: zero failures, production build exit 0, and no whitespace errors.

- [ ] **Step 5: Deploy and verify production**

Deploy:

```bash
npm run deploy:cloudflare
```

Expected: Wrangler reports a Production deployment URL.

Verify unauthenticated behavior without credentials:

```bash
curl -sS -o /dev/null -D - https://ap-yoga-content-studio.pages.dev/ | sed -n '1,12p'
curl -sS -o /dev/null -w '%{http_code}\n' https://ap-yoga-content-studio.pages.dev/api/auth/session
```

Expected: `/` redirects to `/login`; session returns `401`.

Then use a fresh browser context and enter the production credential only in the visible login form. Verify login, refresh, direct private navigation, one real Resource photo through both channel results, logout, desktop 1280×900, mobile 390×844, no horizontal overflow, and no relevant console errors. Capture screenshots outside the repository.

- [ ] **Step 6: Update README and commit**

Document the public login URL, secret names, rotation command, 30-day cookie, KV eventual-consistency limitation, and the rule that credentials must be entered through `npm run auth:provision` only. Do not document actual values.

```bash
git add tests/e2e/auth-flow.spec.ts playwright.config.ts README.md
git commit -m "test: verify protected production workflow"
```

- [ ] **Step 7: Final evidence check**

Run: `git status --short && git log --oneline -10`

Expected: only the pre-existing user-owned `AP_YOGA_Content_Studio_4Docs_v7/` and `Resource/` directories remain untracked; authentication changes are committed in focused commits.
