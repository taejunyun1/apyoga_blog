import { describe, expect, it, vi } from "vitest"
import {
  createPasswordRecord,
  createSession,
  SESSION_SECONDS,
  verifyPassword,
  verifySession,
} from "../../functions/lib/auth"

const encoder = new TextEncoder()

function encode(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url")
}

async function createLegacySessionToken(username: string, secret: string, nowSeconds: number): Promise<string> {
  const payload = encode(encoder.encode(JSON.stringify({
    v: 1,
    sub: username,
    iat: nowSeconds,
    exp: nowSeconds + SESSION_SECONDS,
  })))
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(secret, "base64url"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)))
  return `${payload}.${encode(signature)}`
}

async function testRecord(password: string): Promise<string> {
  const salt = new Uint8Array(16)
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"])
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, key, 256))
  const b64 = (value: Uint8Array) => Buffer.from(value).toString("base64url")
  return `pbkdf2-sha256$100000$${b64(salt)}$${b64(bits)}`
}

describe("authentication cryptography", () => {
  it("creates salted records compatible with verification", async () => {
    const first = await createPasswordRecord("new-password-123")
    const second = await createPasswordRecord("new-password-123")

    expect(first).not.toBe(second)
    await expect(verifyPassword("new-password-123", first)).resolves.toBe(true)
    await expect(verifyPassword("wrong-password-123", first)).resolves.toBe(false)
  })

  it("accepts only the password matching a versioned PBKDF2 record", async () => {
    const encoded = await testRecord("test-password")
    expect(await verifyPassword("test-password", encoded)).toBe(true)
    expect(await verifyPassword("wrong-password", encoded)).toBe(false)
  })

  it("does not depend on the unavailable Pages WebCrypto PBKDF2 path", async () => {
    const encoded = await testRecord("test-password")
    const spy = vi.spyOn(crypto.subtle, "deriveBits").mockRejectedValue(
      new DOMException("PBKDF2 is unavailable in Pages WebCrypto", "NotSupportedError"),
    )

    try {
      await expect(verifyPassword("test-password", encoded)).resolves.toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  it("accepts a signed session until the 30-day expiry", async () => {
    const now = 1_800_000_000
    const secret = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    const token = await createSession("studio-user", secret, "version-1", now)
    expect(await verifySession(token, "studio-user", secret, "version-1", false, now + SESSION_SECONDS - 1)).toBe(true)
    expect(await verifySession(token, "studio-user", secret, "version-1", false, now + SESSION_SECONDS)).toBe(false)
  })

  it("rejects tampered and wrong-account sessions", async () => {
    const secret = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    const token = await createSession("studio-user", secret, "version-1", 1_800_000_000)
    expect(await verifySession(`${token}x`, "studio-user", secret, "version-1", false, 1_800_000_001)).toBe(false)
    expect(await verifySession(`${token}.`, "studio-user", secret, "version-1", false, 1_800_000_001)).toBe(false)
    expect(await verifySession(token, "other-user", secret, "version-1", false, 1_800_000_001)).toBe(false)
  })

  it("binds every newly issued session to the active credential version", async () => {
    const token = await createSession("studio-user", "dGVzdC1zZWNyZXQ", "version-2", 1_000)

    await expect(verifySession(token, "studio-user", "dGVzdC1zZWNyZXQ", "version-2", false, 1_001)).resolves.toBe(true)
    await expect(verifySession(token, "studio-user", "dGVzdC1zZWNyZXQ", "version-3", false, 1_001)).resolves.toBe(false)
  })

  it("refuses to issue a session without a credential version", async () => {
    await expect(createSession("studio-user", "dGVzdC1zZWNyZXQ", "", 1_000)).rejects.toThrow()
  })

  it("allows a legacy v1 session only while the secret credential is active", async () => {
    const legacy = await createLegacySessionToken("studio-user", "dGVzdC1zZWNyZXQ", 1_000)

    await expect(verifySession(legacy, "studio-user", "dGVzdC1zZWNyZXQ", "secret-version", true, 1_001)).resolves.toBe(true)
    await expect(verifySession(legacy, "studio-user", "dGVzdC1zZWNyZXQ", "d1-version", false, 1_001)).resolves.toBe(false)
  })
})
