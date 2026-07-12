import type { AuthEnv } from "./env"

export interface ActiveCredential {
  passwordHash: string
  version: string
  source: "secret" | "d1"
}

interface CredentialRow {
  password_hash: string
  credential_version: string
}

async function secretVersion(passwordHash: string, sessionSecret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(sessionSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`credential:${passwordHash}`)))
  return Array.from(bytes.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function primary(env: AuthEnv) {
  if (!env.AUTH_DB) throw new Error("인증 저장소를 사용할 수 없어요.")
  return env.AUTH_DB.withSession("first-primary")
}

export async function readActiveCredential(env: AuthEnv): Promise<ActiveCredential> {
  const row = await primary(env)
    .prepare("SELECT password_hash, credential_version FROM auth_credentials WHERE id = ?1")
    .bind(1)
    .first<CredentialRow>()
  if (row) {
    if (typeof row.password_hash !== "string" || !row.password_hash
      || typeof row.credential_version !== "string" || !row.credential_version) {
      throw new Error("인증 저장소의 값이 올바르지 않아요.")
    }
    return { passwordHash: row.password_hash, version: row.credential_version, source: "d1" }
  }
  if (!env.AUTH_PASSWORD_HASH || !env.SESSION_SECRET) throw new Error("인증 설정을 확인해 주세요.")
  return {
    passwordHash: env.AUTH_PASSWORD_HASH,
    version: await secretVersion(env.AUTH_PASSWORD_HASH, env.SESSION_SECRET),
    source: "secret",
  }
}

export async function changeCredential(
  env: AuthEnv,
  active: ActiveCredential,
  passwordHash: string,
  version: string,
  updatedAt: string,
): Promise<void> {
  const session = primary(env)
  const result = active.source === "d1"
    ? await session
        .prepare(`UPDATE auth_credentials
          SET password_hash = ?1, credential_version = ?2, updated_at = ?3
          WHERE id = ?4 AND credential_version = ?5`)
        .bind(passwordHash, version, updatedAt, 1, active.version)
        .run()
    : await session
        .prepare(`INSERT INTO auth_credentials (id, password_hash, credential_version, updated_at)
          VALUES (?1, ?2, ?3, ?4)
          ON CONFLICT(id) DO NOTHING`)
        .bind(1, passwordHash, version, updatedAt)
        .run()
  if (!result.success || result.meta.changes !== 1) {
    throw new Error("인증 저장소를 갱신하지 못했어요.")
  }
}
