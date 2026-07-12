import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "../..")

describe("OpenAI provisioning script", () => {
  it("provisions the OpenAI key only through an interactive secret command", () => {
    const script = readFileSync(path.join(root, "scripts/provision-openai.mjs"), "utf8")
    expect(script).toContain("process.stdin.isTTY")
    expect(script).toContain("setRawMode(true)")
    expect(script).toContain('"OPENAI_API_KEY"')
    expect(script).toContain('"wrangler", "pages", "secret", "put"')
    expect(script).not.toMatch(/sk-[A-Za-z0-9_-]{12,}/)
    expect(script).not.toContain("console.log(apiKey)")
  })

  it("keeps local OpenAI secret files out of Git", () => {
    const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8")
    expect(gitignore).toContain(".dev.vars")
    expect(gitignore).toContain(".env")
  })
})
