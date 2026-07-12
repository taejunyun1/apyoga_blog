import { createPasswordRecord, verifyPassword } from "../../lib/auth"
import { changeCredential, readActiveCredential } from "../../lib/credentials"
import type { AuthEnv, PagesHandler } from "../../lib/env"
import { expiredSessionCookie, isSameOriginJson, json } from "../../lib/http"
import { clearFailures, rateLimitKey, readFailures, recordFailure } from "../../lib/rate-limit"

const MAX_BODY_BYTES = 2_048
const GENERIC_FAILURE = { message: "비밀번호를 변경하지 못했어요." }
const INVALID_REQUEST = { message: "요청을 확인해 주세요." }

class PasswordBodyTooLargeError extends Error {}
class InvalidPasswordBodyError extends Error {}

interface PasswordFields {
  currentPassword: string
  newPassword: string
}

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
        try {
          await reader.cancel()
        } catch {
          // The body is already rejected; cancellation failure must not change the response.
        }
        throw new PasswordBodyTooLargeError()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}

function validatePasswordBody(body: unknown): PasswordFields {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new InvalidPasswordBodyError()
  }
  const keys = Object.keys(body).sort()
  if (keys.length !== 2 || keys[0] !== "currentPassword" || keys[1] !== "newPassword") {
    throw new InvalidPasswordBodyError()
  }

  const fields = body as Record<string, unknown>
  if (
    typeof fields.currentPassword !== "string"
    || fields.currentPassword.length === 0
    || fields.currentPassword.length > 256
    || typeof fields.newPassword !== "string"
    || fields.newPassword.length < 12
    || fields.newPassword.length > 256
  ) {
    throw new InvalidPasswordBodyError()
  }
  return fields as unknown as PasswordFields
}

function clearParsedPasswordFields(body: unknown): void {
  if (typeof body !== "object" || body === null) return
  const fields = body as Record<string, unknown>
  for (const key of ["currentPassword", "newPassword"]) {
    try {
      if (!Object.prototype.hasOwnProperty.call(fields, key)) continue
      const password = fields[key]
      if (typeof password === "string") fields[key] = "\0".repeat(password.length)
    } catch {
      // Cleanup is best-effort and must not replace the endpoint response.
    }
  }
}

export async function handlePasswordChange(
  request: Request,
  env: AuthEnv,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<Response> {
  if (!isSameOriginJson(request)) return json(INVALID_REQUEST, 403)
  if (!env.AUTH_RATE_LIMIT || !env.SESSION_SECRET || !env.AUTH_DB) return json(GENERIC_FAILURE, 500)

  let body: unknown
  let currentPassword = ""
  let newPassword = ""
  try {
    let fields: PasswordFields
    try {
      body = await readBoundedJson(request, MAX_BODY_BYTES)
      fields = validatePasswordBody(body)
    } catch (error) {
      if (error instanceof PasswordBodyTooLargeError) return json(INVALID_REQUEST, 413)
      if (error instanceof SyntaxError || error instanceof InvalidPasswordBodyError) {
        return json(INVALID_REQUEST, 400)
      }
      return json(INVALID_REQUEST, 400)
    }
    currentPassword = fields.currentPassword
    newPassword = fields.newPassword

    try {
      const key = await rateLimitKey(request, env.SESSION_SECRET, "password-change")
      const failures = await readFailures(env, key, nowSeconds)
      if (failures.count >= 5) {
        return json({ message: "확인 시도가 많아요. 10분 후 다시 시도해 주세요." }, 429)
      }

      const active = await readActiveCredential(env)
      if (!await verifyPassword(currentPassword, active.passwordHash)) {
        await recordFailure(env, key, failures, nowSeconds)
        return json({ message: "현재 비밀번호를 확인해 주세요." }, 401)
      }
      if (await verifyPassword(newPassword, active.passwordHash)) {
        return json({ message: "새 비밀번호는 현재 비밀번호와 달라야 해요." }, 400)
      }

      const record = await createPasswordRecord(newPassword)
      await changeCredential(
        env,
        record,
        crypto.randomUUID(),
        new Date(nowSeconds * 1_000).toISOString(),
      )
      await clearFailures(env, key)
      return new Response(null, {
        status: 204,
        headers: { "Cache-Control": "no-store", "Set-Cookie": expiredSessionCookie() },
      })
    } catch {
      return json(GENERIC_FAILURE, 503)
    }
  } finally {
    clearParsedPasswordFields(body)
    currentPassword = "\0".repeat(currentPassword.length)
    newPassword = "\0".repeat(newPassword.length)
  }
}

export const onRequestPost: PagesHandler<AuthEnv> = ({ request, env }) => handlePasswordChange(request, env)
