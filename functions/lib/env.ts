export interface RateLimitKV {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>
  delete(key: string): Promise<void>
}

export interface AuthDatabaseStatement {
  bind(...values: unknown[]): AuthDatabaseStatement
  first<T>(): Promise<T | null>
  run(): Promise<{ success: boolean; meta: { changes: number } }>
}

export interface AuthDatabaseSession {
  prepare(query: string): AuthDatabaseStatement
}

export interface AuthDatabase {
  withSession(constraint: "first-primary"): AuthDatabaseSession
}

export interface AuthEnv {
  AUTH_USERNAME: string
  AUTH_PASSWORD_HASH: string
  SESSION_SECRET: string
  AUTH_RATE_LIMIT: RateLimitKV
  AUTH_DB?: AuthDatabase
}

export interface ContentEnv extends AuthEnv {
  OPENAI_API_KEY: string
}

export interface PagesContext<Env> {
  request: Request
  env: Env
  next(): Promise<Response>
}

export type PagesHandler<Env> = (context: PagesContext<Env>) => Response | Promise<Response>
