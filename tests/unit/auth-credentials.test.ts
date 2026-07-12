import { describe, expect, it } from "vitest"
import { changeCredential, readActiveCredential } from "../../functions/lib/credentials"
import type { AuthDatabase, AuthDatabaseSession, AuthDatabaseStatement, AuthEnv } from "../../functions/lib/env"

class FakeStatement implements AuthDatabaseStatement {
  values: unknown[] = []
  constructor(
    private readonly row: Record<string, unknown> | null,
    private readonly onRun: (values: unknown[]) => void,
    private readonly readError?: Error,
    private readonly runSuccess = true,
    private readonly runChanges = 1,
  ) {}
  bind(...values: unknown[]) { this.values = values; return this }
  async first<T>() {
    if (this.readError) throw this.readError
    return this.row as T | null
  }
  async run() {
    this.onRun(this.values)
    return { success: this.runSuccess, meta: { changes: this.runChanges } }
  }
}

class FakeSession implements AuthDatabaseSession {
  readonly runs: unknown[][] = []
  readonly queries: string[] = []
  constructor(
    readonly row: Record<string, unknown> | null,
    readonly options: { readError?: Error; runSuccess?: boolean; runChanges?: number } = {},
  ) {}
  prepare(query: string) {
    this.queries.push(query)
    return new FakeStatement(
      this.row,
      (values) => this.runs.push(values),
      this.options.readError,
      this.options.runSuccess,
      this.options.runChanges,
    )
  }
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
    const session = new FakeSession({
      password_hash: "d1-password-record",
      credential_version: "version-2",
    })
    const database = new FakeDatabase(session)
    await expect(readActiveCredential(env(database))).resolves.toEqual({
      passwordHash: "d1-password-record",
      version: "version-2",
      source: "d1",
    })
    expect(database.constraint).toBe("first-primary")
    const readSql = session.queries[0].replace(/\s+/g, " ")
    expect(readSql).toContain("SELECT password_hash, credential_version FROM auth_credentials")
    expect(readSql).toContain("WHERE id = ?1")
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

  it("propagates rejected D1 reads without consulting the secret fallback", async () => {
    const database = new FakeDatabase(new FakeSession(null, { readError: new Error("D1 read failed") }))
    const runtimeEnv = env(database)
    Object.defineProperty(runtimeEnv, "AUTH_PASSWORD_HASH", {
      get: () => { throw new Error("secret fallback accessed") },
    })

    await expect(readActiveCredential(runtimeEnv)).rejects.toThrow("D1 read failed")
  })

  it.each([
    ["empty password hash", { password_hash: "", credential_version: "version-2" }],
    ["non-string password hash", { password_hash: 42, credential_version: "version-2" }],
    ["empty credential version", { password_hash: "d1-password-record", credential_version: "" }],
    ["non-string credential version", { password_hash: "d1-password-record", credential_version: 42 }],
  ])("rejects a present row with %s", async (_label, row) => {
    await expect(readActiveCredential(env(new FakeDatabase(new FakeSession(row))))).rejects.toThrow("올바르지 않아요")
  })

  it("conditionally updates the D1 credential version that was verified", async () => {
    const session = new FakeSession(null)
    await changeCredential(
      env(new FakeDatabase(session)),
      { passwordHash: "old-record", version: "version-2", source: "d1" },
      "new-record",
      "version-3",
      "2026-07-12T12:00:00.000Z",
    )
    expect(session.runs).toEqual([["new-record", "version-3", "2026-07-12T12:00:00.000Z", 1, "version-2"]])
    const writeSql = session.queries[0].replace(/\s+/g, " ")
    expect(writeSql).toContain("UPDATE auth_credentials")
    expect(writeSql).toContain("password_hash = ?1")
    expect(writeSql).toContain("credential_version = ?2")
    expect(writeSql).toContain("updated_at = ?3")
    expect(writeSql).toContain("WHERE id = ?4 AND credential_version = ?5")
  })

  it("conditionally inserts a D1 override when the verified credential came from the secret", async () => {
    const session = new FakeSession(null)
    await changeCredential(
      env(new FakeDatabase(session)),
      { passwordHash: "secret-record", version: "derived-version", source: "secret" },
      "new-record",
      "version-3",
      "2026-07-12T12:00:00.000Z",
    )
    expect(session.runs).toEqual([[1, "new-record", "version-3", "2026-07-12T12:00:00.000Z"]])
    const writeSql = session.queries[0].replace(/\s+/g, " ")
    expect(writeSql).toContain("INSERT INTO auth_credentials (id, password_hash, credential_version, updated_at)")
    expect(writeSql).toContain("ON CONFLICT(id) DO NOTHING")
  })

  it("rejects a stale credential update when D1 changes no rows", async () => {
    const session = new FakeSession(null, { runChanges: 0 })

    await expect(changeCredential(
      env(new FakeDatabase(session)),
      { passwordHash: "old-record", version: "stale-version", source: "d1" },
      "new-record",
      "version-3",
      "2026-07-12T12:00:00.000Z",
    )).rejects.toThrow("갱신하지 못했어요")
  })

  it("rejects a credential update when D1 reports an unsuccessful run", async () => {
    const session = new FakeSession(null, { runSuccess: false })

    await expect(changeCredential(
      env(new FakeDatabase(session)),
      { passwordHash: "old-record", version: "version-2", source: "d1" },
      "new-record",
      "version-3",
      "2026-07-12T12:00:00.000Z",
    )).rejects.toThrow("갱신하지 못했어요")
  })
})
