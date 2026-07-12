import type {
  AuthDatabase,
  AuthDatabaseSession,
  AuthDatabaseStatement,
} from "../../functions/lib/env"

interface FakeAuthDatabaseOptions {
  row?: Record<string, unknown> | null
  readError?: Error
  runSuccess?: boolean
}

class FakeAuthStatement implements AuthDatabaseStatement {
  constructor(private readonly options: FakeAuthDatabaseOptions) {}

  bind(..._values: unknown[]): AuthDatabaseStatement {
    return this
  }

  async first<T>(): Promise<T | null> {
    if (this.options.readError) throw this.options.readError
    return (this.options.row ?? null) as T | null
  }

  async run(): Promise<{ success: boolean; meta: { changes: number } }> {
    return { success: this.options.runSuccess ?? true, meta: { changes: 1 } }
  }
}

class FakeAuthSession implements AuthDatabaseSession {
  constructor(private readonly options: FakeAuthDatabaseOptions) {}

  prepare(_query: string): AuthDatabaseStatement {
    return new FakeAuthStatement(this.options)
  }
}

export function fakeAuthDatabase(options: FakeAuthDatabaseOptions = {}): AuthDatabase {
  return {
    withSession: () => new FakeAuthSession(options),
  }
}
