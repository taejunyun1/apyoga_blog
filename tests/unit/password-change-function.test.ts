import { beforeAll, describe, expect, it } from "vitest"
import { handlePasswordChange, onRequestPost } from "../../functions/api/auth/password"
import { createPasswordRecord, verifyPassword } from "../../functions/lib/auth"
import type {
  AuthDatabase,
  AuthDatabaseSession,
  AuthDatabaseStatement,
  AuthEnv,
  RateLimitKV,
} from "../../functions/lib/env"

const secret = "dGVzdC1wYXNzd29yZC1jaGFuZ2Utc2VjcmV0"
const nowSeconds = 1_000
let initialPasswordHash: string

class MemoryRateLimitKV implements RateLimitKV {
  readonly values = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null
  }

  async put(key: string, value: string, _options: { expirationTtl: number }): Promise<void> {
    this.values.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key)
  }
}

class CredentialStatement implements AuthDatabaseStatement {
  private values: unknown[] = []

  constructor(
    private readonly database: CredentialDatabase,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): AuthDatabaseStatement {
    this.values = values
    return this
  }

  async first<T>(): Promise<T | null> {
    if (this.database.readError) throw this.database.readError
    return {
      password_hash: this.database.latest.passwordHash,
      credential_version: this.database.latest.version,
    } as T
  }

  async run(): Promise<{ success: boolean }> {
    if (this.database.writeError) throw this.database.writeError
    expect(this.query).toContain("INSERT INTO auth_credentials")
    this.database.latest = {
      passwordHash: String(this.values[1]),
      version: String(this.values[2]),
      updatedAt: String(this.values[3]),
    }
    this.database.writes.push([...this.values])
    return { success: true }
  }
}

class CredentialDatabase implements AuthDatabase {
  latest: { passwordHash: string; version: string; updatedAt?: string }
  readonly writes: unknown[][] = []
  readError?: Error
  writeError?: Error

  constructor(passwordHash: string) {
    this.latest = { passwordHash, version: "version-1" }
  }

  withSession(constraint: "first-primary"): AuthDatabaseSession {
    expect(constraint).toBe("first-primary")
    return {
      prepare: (query) => new CredentialStatement(this, query),
    }
  }
}

function passwordRequest(body: unknown, init: RequestInit = {}): Request {
  const { headers, ...requestInit } = init
  return new Request("https://studio.example/api/auth/password", {
    method: "POST",
    headers: { Origin: "https://studio.example", "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    ...requestInit,
  })
}

function malformedRequest(body: BodyInit, headers: HeadersInit = {}): Request {
  return new Request("https://studio.example/api/auth/password", {
    method: "POST",
    headers: { Origin: "https://studio.example", "Content-Type": "application/json", ...headers },
    body,
  })
}

function makeEnv(database = new CredentialDatabase(initialPasswordHash), rateLimit = new MemoryRateLimitKV()) {
  const env: AuthEnv = {
    AUTH_USERNAME: "studio-user",
    AUTH_PASSWORD_HASH: "secret-fallback-must-not-be-used",
    SESSION_SECRET: secret,
    AUTH_RATE_LIMIT: rateLimit,
    AUTH_DB: database,
  }
  Object.defineProperty(env, "AUTH_PASSWORD_HASH", {
    get: () => { throw new Error("secret password fallback accessed") },
  })
  return { database, env, rateLimit }
}

async function expectFailure(response: Response, status: number): Promise<void> {
  expect(response.status).toBe(status)
  expect(response.headers.get("Cache-Control")).toBe("no-store")
  expect(response.headers.get("Set-Cookie")).toBeNull()
}

beforeAll(async () => {
  initialPasswordHash = await createPasswordRecord("test-password")
})

describe("authenticated password-change Function", () => {
  it("writes a new D1 password record and expires the current session on success", async () => {
    const { database, env } = makeEnv()
    const response = await handlePasswordChange(passwordRequest({
      currentPassword: "test-password",
      newPassword: "new-password-123",
    }), env, nowSeconds)

    expect(response.status).toBe(204)
    expect(database.writes).toHaveLength(1)
    expect(database.latest.passwordHash).not.toContain("new-password-123")
    await expect(verifyPassword("new-password-123", database.latest.passwordHash)).resolves.toBe(true)
    expect(database.latest.version).not.toBe("version-1")
    expect(database.latest.updatedAt).toBe("1970-01-01T00:16:40.000Z")
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0")
    expect(response.headers.get("Cache-Control")).toBe("no-store")
  })

  it("clears the mutable parsed password fields after handling", async () => {
    const fields = {
      currentPassword: "test-password",
      newPassword: "new-password-123",
    }
    const request = new Request("https://studio.example/api/auth/password", {
      method: "POST",
      headers: { Origin: "https://studio.example", "Content-Type": "application/json" },
    })
    Object.defineProperty(request, "json", { value: async () => fields })
    const { env } = makeEnv()

    const response = await handlePasswordChange(request, env, nowSeconds)

    expect(response.status).toBe(204)
    expect(fields).toEqual({
      currentPassword: "\0".repeat("test-password".length),
      newPassword: "\0".repeat("new-password-123".length),
    })
  })

  it("clears string password fields when the parsed object fails exact-key validation", async () => {
    const fields = {
      currentPassword: "test-password",
      newPassword: "new-password-123",
      extra: true,
    }
    const request = new Request("https://studio.example/api/auth/password", {
      method: "POST",
      headers: { Origin: "https://studio.example", "Content-Type": "application/json" },
    })
    Object.defineProperty(request, "json", { value: async () => fields })
    const { env } = makeEnv()

    const response = await handlePasswordChange(request, env, nowSeconds)

    await expectFailure(response, 400)
    expect(fields).toEqual({
      currentPassword: "\0".repeat("test-password".length),
      newPassword: "\0".repeat("new-password-123".length),
      extra: true,
    })
  })

  it("exposes the Pages POST handler", async () => {
    const { env } = makeEnv()
    const response = await onRequestPost({
      request: passwordRequest({ currentPassword: "test-password", newPassword: "new-password-123" }),
      env,
      next: async () => new Response(null, { status: 599 }),
    })

    expect(response.status).toBe(204)
  })

  it("rejects a wrong current password without changing D1 or expiring the session", async () => {
    const { database, env } = makeEnv()
    const response = await handlePasswordChange(passwordRequest({
      currentPassword: "wrong-password",
      newPassword: "new-password-123",
    }), env, nowSeconds)

    await expectFailure(response, 401)
    await expect(response.json()).resolves.toEqual({ message: "현재 비밀번호를 확인해 주세요." })
    expect(database.writes).toHaveLength(0)
  })

  it("locks the sixth current-password failure in a password-change-only window", async () => {
    const { env, rateLimit } = makeEnv()
    const request = () => passwordRequest(
      { currentPassword: "wrong-password", newPassword: "new-password-123" },
      { headers: { "CF-Connecting-IP": "203.0.113.42" } },
    )

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expectFailure(await handlePasswordChange(request(), env, nowSeconds), 401)
    }
    const response = await handlePasswordChange(request(), env, nowSeconds)

    await expectFailure(response, 429)
    await expect(response.json()).resolves.toEqual({ message: "확인 시도가 많아요. 10분 후 다시 시도해 주세요." })
    expect([...rateLimit.values.keys()]).toHaveLength(1)
    expect([...rateLimit.values.keys()][0]).toMatch(/^password-change:[a-f0-9]{64}$/)
    expect([...rateLimit.values.keys()][0]).not.toContain("203.0.113.42")
  })

  it.each([
    ["shorter than 12 characters", "short-pass", 400],
    ["longer than 256 characters", "x".repeat(257), 400],
    ["the current password", "test-password", 400],
  ])("rejects a new password that is %s", async (_label, newPassword, status) => {
    const { database, env } = makeEnv()
    const response = await handlePasswordChange(passwordRequest({
      currentPassword: "test-password",
      newPassword,
    }), env, nowSeconds)

    await expectFailure(response, status)
    expect(database.writes).toHaveLength(0)
  })

  it.each([
    ["an unknown key", { currentPassword: "test-password", newPassword: "new-password-123", extra: true }],
    ["a missing key", { currentPassword: "test-password" }],
    ["a non-string field", { currentPassword: 1, newPassword: "new-password-123" }],
    ["a null body", null],
  ])("rejects a body containing %s", async (_label, body) => {
    const { env } = makeEnv()
    const response = await handlePasswordChange(passwordRequest(body), env, nowSeconds)

    await expectFailure(response, 400)
    await expect(response.json()).resolves.toEqual({ message: "요청을 확인해 주세요." })
  })

  it("rejects malformed JSON", async () => {
    const { env } = makeEnv()
    const response = await handlePasswordChange(malformedRequest("{"), env, nowSeconds)

    await expectFailure(response, 400)
    await expect(response.json()).resolves.toEqual({ message: "요청을 확인해 주세요." })
  })

  it.each([
    ["cross-origin", { Origin: "https://evil.example", "Content-Type": "application/json" }],
    ["non-JSON", { Origin: "https://studio.example", "Content-Type": "text/plain" }],
  ])("rejects a %s request before reading credentials", async (_label, headers) => {
    const { env } = makeEnv()
    const response = await handlePasswordChange(passwordRequest({
      currentPassword: "test-password",
      newPassword: "new-password-123",
    }, { headers }), env, nowSeconds)

    await expectFailure(response, 403)
    await expect(response.json()).resolves.toEqual({ message: "요청을 확인해 주세요." })
  })

  it("rejects a declared body larger than 2,048 bytes", async () => {
    const { env } = makeEnv()
    const response = await handlePasswordChange(malformedRequest("{}", { "Content-Length": "2049" }), env, nowSeconds)

    await expectFailure(response, 413)
  })

  it("cancels a streamed body immediately after reading byte 2,049", async () => {
    const chunks = [new Uint8Array(1_024), new Uint8Array(1_024), new Uint8Array(1), new Uint8Array(1_024)]
    let pulls = 0
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunks[pulls])
        pulls += 1
        if (pulls === chunks.length) controller.close()
      },
      cancel() {
        cancelled = true
      },
    }, { highWaterMark: 0 })
    const request = new Request("https://studio.example/api/auth/password", {
      method: "POST",
      headers: { Origin: "https://studio.example", "Content-Type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" })
    const { env } = makeEnv()

    const response = await handlePasswordChange(request, env, nowSeconds)

    await expectFailure(response, 413)
    expect(cancelled).toBe(true)
    expect(pulls).toBe(3)
  })

  it("keeps the 413 response when streamed-body cancellation rejects", async () => {
    const chunks = [new Uint8Array(2_049), new Uint8Array(1_024)]
    let pulls = 0
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunks[pulls])
        pulls += 1
      },
      cancel() {
        cancelled = true
        throw new Error("synthetic cancellation failure must stay private")
      },
    }, { highWaterMark: 0 })
    const request = new Request("https://studio.example/api/auth/password", {
      method: "POST",
      headers: { Origin: "https://studio.example", "Content-Type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" })
    const { env } = makeEnv()

    const response = await handlePasswordChange(request, env, nowSeconds)

    await expectFailure(response, 413)
    expect(await response.text()).not.toContain("synthetic cancellation failure")
    expect(cancelled).toBe(true)
    expect(pulls).toBe(1)
  })

  it("maps D1 write failures to a generic 503 without exception text or cookie expiry", async () => {
    const database = new CredentialDatabase(initialPasswordHash)
    database.writeError = new Error("synthetic D1 internals must stay private")
    const { env } = makeEnv(database)

    const response = await handlePasswordChange(passwordRequest({
      currentPassword: "test-password",
      newPassword: "new-password-123",
    }), env, nowSeconds)

    await expectFailure(response, 503)
    const text = await response.text()
    expect(text).not.toContain("synthetic D1 internals")
    expect(JSON.parse(text)).toEqual({ message: "비밀번호를 변경하지 못했어요." })
  })

  it.each(["AUTH_RATE_LIMIT", "SESSION_SECRET", "AUTH_DB"] as const)(
    "fails closed when the %s binding is missing",
    async (binding) => {
      const { env } = makeEnv()
      const incompleteEnv = Object.create(Object.getPrototypeOf(env)) as AuthEnv
      Object.defineProperties(incompleteEnv, Object.getOwnPropertyDescriptors(env))
      Object.defineProperty(incompleteEnv, binding, { configurable: true, value: undefined })
      const response = await handlePasswordChange(passwordRequest({
        currentPassword: "test-password",
        newPassword: "new-password-123",
      }), incompleteEnv, nowSeconds)

      await expectFailure(response, 500)
      await expect(response.json()).resolves.toEqual({ message: "비밀번호를 변경하지 못했어요." })
    },
  )
})
