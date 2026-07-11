import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "../..")

describe("Cloudflare Pages deployment", () => {
  it("defines a production Pages project for the Vite dist directory", () => {
    const configPath = path.join(root, "wrangler.jsonc")
    expect(existsSync(configPath)).toBe(true)
    if (!existsSync(configPath)) return

    const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>
    expect(config.name).toBe("ap-yoga-content-studio")
    expect(config.pages_build_output_dir).toBe("./dist")
    expect(config.compatibility_date).toBe("2026-07-11")
  })

  it("builds before invoking the checked-in Wrangler CLI", () => {
    const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>
      devDependencies: Record<string, string>
    }

    expect(packageJson.scripts["predeploy:cloudflare"]).toBe("npm run build")
    expect(packageJson.scripts["deploy:cloudflare"]).toBe("wrangler pages deploy --branch master")
    expect(packageJson.devDependencies.wrangler).toMatch(/^\^4\./)
  })

  it("keeps Wrangler state and local Cloudflare secrets out of Git", () => {
    const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8")
    expect(gitignore).toContain(".wrangler/")
    expect(gitignore).toContain(".dev.vars")
  })
})
