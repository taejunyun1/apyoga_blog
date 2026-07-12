import { describe, expect, it, vi } from "vitest"
import { createSession, SESSION_SECONDS, verifyPassword, verifySession } from "../../functions/lib/auth"

async function testRecord(password: string): Promise<string> {
  const salt = new Uint8Array(16)
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"])
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 600_000 }, key, 256))
  const b64 = (value: Uint8Array) => Buffer.from(value).toString("base64url")
  return `pbkdf2-sha256$600000$${b64(salt)}$${b64(bits)}`
}

describe("authentication cryptography", () => {
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
    const token = await createSession("studio-user", secret, now)
    expect(await verifySession(token, "studio-user", secret, now + SESSION_SECONDS - 1)).toBe(true)
    expect(await verifySession(token, "studio-user", secret, now + SESSION_SECONDS)).toBe(false)
  })

  it("rejects tampered and wrong-account sessions", async () => {
    const secret = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    const token = await createSession("studio-user", secret, 1_800_000_000)
    expect(await verifySession(`${token}x`, "studio-user", secret, 1_800_000_001)).toBe(false)
    expect(await verifySession(`${token}.`, "studio-user", secret, 1_800_000_001)).toBe(false)
    expect(await verifySession(token, "other-user", secret, 1_800_000_001)).toBe(false)
  })
})
