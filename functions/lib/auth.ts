import { pbkdf2 } from "node:crypto"

export const SESSION_COOKIE = "ap_yoga_session"
export const SESSION_SECONDS = 30 * 24 * 60 * 60
const encoder = new TextEncoder()

function derivePassword(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, iterations, 32, "sha256", (error, derived) => {
      if (error) reject(error)
      else resolve(new Uint8Array(derived))
    })
  })
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")
  return new Uint8Array(Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)))
}

function encode(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, iterationsText, saltText, hashText] = encoded.split("$")
  const iterations = Number(iterationsText)
  if (algorithm !== "pbkdf2-sha256" || iterations !== 100_000 || password.length > 256) return false
  try {
    const salt = decode(saltText)
    const expected = decode(hashText)
    if (salt.length !== 16 || expected.length !== 32) return false
    return equal(await derivePassword(password, salt, iterations), expected)
  } catch {
    return false
  }
}

async function hmac(payload: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", decode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)))
}

export async function createSession(username: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const payload = encode(encoder.encode(JSON.stringify({ v: 1, sub: username, iat: nowSeconds, exp: nowSeconds + SESSION_SECONDS })))
  return `${payload}.${encode(await hmac(payload, secret))}`
}

export async function verifySession(token: string, username: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const parts = token.split(".")
  if (parts.length !== 2) return false
  const [payload, signature] = parts
  if (!payload || !signature) return false
  try {
    if (!equal(decode(signature), await hmac(payload, secret))) return false
    const value = JSON.parse(new TextDecoder().decode(decode(payload))) as { v?: number; sub?: string; iat?: number; exp?: number }
    return value.v === 1 && value.sub === username && Number.isInteger(value.iat) && Number.isInteger(value.exp) && value.iat! <= nowSeconds && value.exp! > nowSeconds && value.exp! - value.iat! === SESSION_SECONDS
  } catch {
    return false
  }
}
