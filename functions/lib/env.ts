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
