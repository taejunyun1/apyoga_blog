import { createSession, verifyPassword } from "../../lib/auth"
import type { AuthEnv, PagesHandler } from "../../lib/env"
import { isSameOriginJson, json, sessionCookie } from "../../lib/http"
import { clearFailures, rateLimitKey, readFailures, recordFailure } from "../../lib/rate-limit"

const INVALID = { message: "아이디 또는 비밀번호를 확인해 주세요." }

export async function handleLogin(request: Request, env: AuthEnv): Promise<Response> {
  if (!isSameOriginJson(request)) return json({ message: "요청을 확인해 주세요." }, 403)
  if (!env.AUTH_USERNAME || !env.AUTH_PASSWORD_HASH || !env.SESSION_SECRET || !env.AUTH_RATE_LIMIT) {
    return json({ message: "로그인을 처리하지 못했어요. 잠시 후 다시 시도해 주세요." }, 500)
  }

  const key = await rateLimitKey(request, env.SESSION_SECRET)
  const failures = await readFailures(env, key)
  if (failures >= 5) return json({ message: "로그인 시도가 많아요. 10분 후 다시 시도해 주세요." }, 429)

  let body: { username?: unknown; password?: unknown }
  try {
    body = await request.json() as typeof body
  } catch {
    return json({ message: "요청을 확인해 주세요." }, 400)
  }

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
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store", "Set-Cookie": sessionCookie(token) },
  })
}

export const onRequestPost: PagesHandler<AuthEnv> = ({ request, env }) => handleLogin(request, env)
