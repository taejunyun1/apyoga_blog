import type {
  AuthDatabase,
  AuthDatabaseSession,
  AuthDatabaseStatement,
} from "../../functions/lib/env"

interface FakeAuthDatabaseOptions {
  row?: Record<string, unknown> | null
  summary?: Record<string, unknown> | null
  readError?: Error
  runSuccess?: boolean
}

class FakeAuthStatement implements AuthDatabaseStatement {
  constructor(
    private readonly options: FakeAuthDatabaseOptions,
    private readonly observability?: FakeUsageDatabase,
  ) {}

  bind(...values: unknown[]): AuthDatabaseStatement {
    if (this.observability) this.observability.lastBoundValues = values
    return this
  }

  async first<T>(): Promise<T | null> {
    if (this.options.readError) throw this.options.readError
    return (this.options.summary ?? this.options.row ?? null) as T | null
  }

  async run(): Promise<{ success: boolean; meta: { changes: number } }> {
    return { success: this.options.runSuccess ?? true, meta: { changes: 1 } }
  }
}

class FakeAuthSession implements AuthDatabaseSession {
  constructor(
    private readonly options: FakeAuthDatabaseOptions,
    private readonly observability?: FakeUsageDatabase,
  ) {}

  prepare(query: string): AuthDatabaseStatement {
    if (this.observability) this.observability.lastQuery = query
    return new FakeAuthStatement(this.options, this.observability)
  }
}

export function fakeAuthDatabase(options: FakeAuthDatabaseOptions = {}): AuthDatabase {
  return {
    withSession: () => new FakeAuthSession(options),
  }
}

export interface FakeUsageDatabase extends AuthDatabase {
  lastQuery: string
  lastBoundValues: unknown[]
}

export function fakeUsageDatabase(options: FakeAuthDatabaseOptions = {}): FakeUsageDatabase {
  const database: FakeUsageDatabase = {
    lastQuery: "",
    lastBoundValues: [],
    withSession: () => new FakeAuthSession(options, database),
  }
  return database
}
