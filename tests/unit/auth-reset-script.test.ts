import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { describe, expect, it } from "vitest"

type SpawnResult = { status: number | null; error?: Error }

type ResetDependencies = {
  inputIsTTY: boolean
  outputIsTTY: boolean
  readUsername: () => Promise<string>
  readHidden: (prompt: string) => Promise<string>
  spawnSync: (command: string, args: string[], options: Record<string, unknown>) => SpawnResult
  fetch: (url: string, init: RequestInit) => Promise<Response>
  randomBytes: (size: number) => Buffer
  pbkdf2Sync: (password: string, salt: Buffer, iterations: number, size: number, digest: string) => Buffer
  timeoutSignal: () => AbortSignal
  writeOutput: (value: string) => void
}

const scriptUrl = pathToFileURL(path.resolve("scripts/reset-auth.mjs")).href
const { resetAdministrator } = await import(scriptUrl) as {
  resetAdministrator: (dependencies: ResetDependencies) => Promise<void>
}

function response(status: number, cookie?: string) {
  return new Response(null, { status, headers: cookie ? { "Set-Cookie": cookie } : undefined })
}

function harness(options: {
  username?: string
  hidden?: string[]
  inputIsTTY?: boolean
  outputIsTTY?: boolean
  spawnResults?: SpawnResult[]
  fetchResults?: Array<Response | Error>
} = {}) {
  const events: string[] = []
  const spawns: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = []
  const fetches: Array<{ url: string; init: RequestInit }> = []
  const hidden = [...(options.hidden ?? ["synthetic-password", "synthetic-password"])]
  const spawnResults = [...(options.spawnResults ?? [])]
  const fetchResults = [...(options.fetchResults ?? [
    response(204, "ap_yoga_session=synthetic-cookie; Max-Age=1800; Path=/; HttpOnly"),
    response(204),
  ])]

  const dependencies: ResetDependencies = {
    inputIsTTY: options.inputIsTTY ?? true,
    outputIsTTY: options.outputIsTTY ?? true,
    readUsername: async () => {
      events.push("read:username")
      return options.username ?? "studio-user"
    },
    readHidden: async (prompt) => {
      events.push(prompt.includes("확인") ? "read:confirmation" : "read:password")
      return hidden.shift() ?? ""
    },
    spawnSync: (command, args, spawnOptions) => {
      spawns.push({ command, args, options: spawnOptions })
      if (command === "npm") events.push("spawn:deploy")
      else if (args[1] === "d1") events.push("spawn:d1-delete")
      else events.push(`spawn:secret:${args[4]}`)
      return spawnResults.shift() ?? { status: 0 }
    },
    fetch: async (url, init) => {
      fetches.push({ url, init })
      events.push(url.endsWith("/login") ? "fetch:login" : "fetch:logout")
      const result = fetchResults.shift() ?? response(204)
      if (result instanceof Error) throw result
      return result
    },
    randomBytes: (size) => {
      events.push(`random:${size}`)
      return Buffer.alloc(size, size === 16 ? 1 : 2)
    },
    pbkdf2Sync: (password, salt, iterations, size, digest) => {
      events.push("crypto:pbkdf2")
      expect(password).toBe("synthetic-password")
      expect(salt).toEqual(Buffer.alloc(16, 1))
      expect([iterations, size, digest]).toEqual([100_000, 32, "sha256"])
      return Buffer.alloc(32, 3)
    },
    timeoutSignal: () => AbortSignal.abort("synthetic-only"),
    writeOutput: (value) => events.push(`output:${value.trim()}`),
  }

  return { dependencies, events, spawns, fetches }
}

function operationEvents(events: string[]) {
  return events.filter((event) => /^(spawn|fetch|output):/.test(event))
}

describe("administrator password reset", () => {
  it("executes the failure-safe reset in actual dependency call order", async () => {
    const run = harness()

    await resetAdministrator(run.dependencies)

    expect(run.events).toEqual([
      "read:username",
      "read:password",
      "read:confirmation",
      "random:16",
      "crypto:pbkdf2",
      "random:32",
      "spawn:secret:AUTH_PASSWORD_HASH",
      "spawn:secret:SESSION_SECRET",
      "spawn:deploy",
      "spawn:d1-delete",
      "fetch:login",
      "fetch:logout",
      "output:관리자 비밀번호 초기화 완료",
    ])

    const passwordHash = `pbkdf2-sha256$100000$${Buffer.alloc(16, 1).toString("base64url")}$${Buffer.alloc(32, 3).toString("base64url")}`
    const sessionSecret = Buffer.alloc(32, 2).toString("base64url")
    expect(run.spawns[0]).toMatchObject({
      command: "npx",
      args: ["wrangler", "pages", "secret", "put", "AUTH_PASSWORD_HASH", "--project-name", "ap-yoga-content-studio"],
      options: { input: `${passwordHash}\n`, stdio: ["pipe", "inherit", "inherit"], encoding: "utf8" },
    })
    expect(run.spawns[1]).toMatchObject({
      command: "npx",
      args: ["wrangler", "pages", "secret", "put", "SESSION_SECRET", "--project-name", "ap-yoga-content-studio"],
      options: { input: `${sessionSecret}\n`, stdio: ["pipe", "inherit", "inherit"], encoding: "utf8" },
    })
    expect(run.spawns[2]).toEqual({
      command: "npm",
      args: ["run", "deploy:cloudflare"],
      options: { stdio: "inherit", encoding: "utf8" },
    })
    expect(run.spawns[3]).toEqual({
      command: "npx",
      args: [
        "wrangler", "d1", "execute", "ap-yoga-auth", "--remote", "--command",
        "DELETE FROM auth_credentials WHERE id = 1",
      ],
      options: { stdio: "inherit", encoding: "utf8" },
    })
    expect(run.spawns.flatMap(({ args }) => args)).not.toContain(passwordHash)
    expect(run.spawns.flatMap(({ args }) => args)).not.toContain(sessionSecret)
    expect(run.spawns.flatMap(({ args }) => args)).not.toContain("synthetic-password")
    expect(run.fetches[0]).toMatchObject({
      url: "https://ap-yoga-content-studio.pages.dev/api/auth/login",
      init: {
        method: "POST",
        headers: { Origin: "https://ap-yoga-content-studio.pages.dev", "Content-Type": "application/json" },
        body: JSON.stringify({ username: "studio-user", password: "synthetic-password" }),
      },
    })
    expect(run.fetches[1]).toMatchObject({
      url: "https://ap-yoga-content-studio.pages.dev/api/auth/logout",
      init: {
        method: "POST",
        headers: {
          Origin: "https://ap-yoga-content-studio.pages.dev",
          "Content-Type": "application/json",
          Cookie: "ap_yoga_session=synthetic-cookie",
        },
      },
    })
  })

  it("requires a fake interactive TTY before reading any input", async () => {
    const run = harness({ inputIsTTY: false })

    await expect(resetAdministrator(run.dependencies)).rejects.toThrow("대화형 터미널")

    expect(run.events).toEqual([])
  })

  it.each([
    ["empty username", "", ["synthetic-password", "synthetic-password"]],
    ["empty password", "studio-user", ["", ""]],
    ["mismatch", "studio-user", ["synthetic-password", "different-password"]],
    ["too short", "studio-user", ["short", "short"]],
    ["too long", "studio-user", ["x".repeat(257), "x".repeat(257)]],
  ])("rejects %s before crypto or external operations", async (_name, username, hidden) => {
    const run = harness({ username, hidden })

    await expect(resetAdministrator(run.dependencies)).rejects.toThrow()

    expect(run.events.some((event) => /^(random|crypto|spawn|fetch|output):/.test(event))).toBe(false)
  })

  it.each([
    ["password-hash secret", 0],
    ["session secret", 1],
    ["deployment", 2],
    ["D1 deletion", 3],
  ])("suppresses every later operation after a nonzero %s result", async (_name, failureIndex) => {
    const results = Array.from({ length: failureIndex + 1 }, (_, index) => ({ status: index === failureIndex ? 1 : 0 }))
    const run = harness({ spawnResults: results })

    await expect(resetAdministrator(run.dependencies)).rejects.toThrow()

    expect(operationEvents(run.events)).toEqual([
      "spawn:secret:AUTH_PASSWORD_HASH",
      "spawn:secret:SESSION_SECRET",
      "spawn:deploy",
      "spawn:d1-delete",
    ].slice(0, failureIndex + 1))
  })

  it.each([
    ["spawn error", { status: 0, error: new Error("synthetic spawn error") }],
    ["null status", { status: null }],
  ])("treats %s as failure and stops before the second secret", async (_name, result) => {
    const run = harness({ spawnResults: [result] })

    await expect(resetAdministrator(run.dependencies)).rejects.toThrow("AUTH_PASSWORD_HASH")

    expect(operationEvents(run.events)).toEqual(["spawn:secret:AUTH_PASSWORD_HASH"])
  })

  it.each([
    ["login rejection", [new Error("synthetic login network failure")], ["fetch:login"]],
    ["login status", [response(500)], ["fetch:login"]],
    ["logout rejection", [response(204), new Error("synthetic logout network failure")], ["fetch:login", "fetch:logout"]],
    ["logout status", [response(204), response(500)], ["fetch:login", "fetch:logout"]],
  ] as const)("suppresses completion after a %s failure", async (_name, fetchResults, expectedFetchEvents) => {
    const run = harness({ fetchResults: [...fetchResults] })

    await expect(resetAdministrator(run.dependencies)).rejects.toThrow()

    expect(run.events.filter((event) => event.startsWith("fetch:"))).toEqual(expectedFetchEvents)
    expect(run.events.some((event) => event.startsWith("output:"))).toBe(false)
  })

  it("keeps raw-mode and secret-channel security contracts behind an import-safe CLI guard", () => {
    const source = readFileSync("scripts/reset-auth.mjs", "utf8")

    expect(source).toContain("process.stdin.isTTY")
    expect(source).toContain("setRawMode(true)")
    expect(source).toContain("input: `${value}\\n`")
    expect(source).toContain("pathToFileURL(process.argv[1])")
    expect(source).not.toMatch(/sk-[A-Za-z0-9_-]{12,}/)
    expect(source).not.toContain("console.log(password")
    expect(source).not.toMatch(/process\.env\.[A-Z_]*PASSWORD/)
    expect(source).toContain('password = "\\0".repeat(password.length)')
    expect(source).toContain('confirmation = "\\0".repeat(confirmation.length)')
    expect(source).toContain('passwordHash = "\\0".repeat(passwordHash.length)')
    expect(source).toContain('sessionSecret = "\\0".repeat(sessionSecret.length)')
  })

  it("publishes the package and username documentation contracts", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>
    }
    const readme = readFileSync("README.md", "utf8")

    expect(packageJson.scripts["auth:reset"]).toBe("node scripts/reset-auth.mjs")
    expect(readme).toContain("npm run auth:reset")
    expect(readme).toContain("기존 관리자 아이디")
    expect(readme).toContain("로그인 확인에만 사용")
    expect(readme).toContain("아이디는 변경하지 않습니다")
  })
})
