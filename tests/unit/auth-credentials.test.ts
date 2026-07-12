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
