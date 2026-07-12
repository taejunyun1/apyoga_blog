import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "../..")

describe("Cloudflare Pages deployment", () => {
  it("routes authentication requests through Pages Functions", () => {
    const routesPath = path.join(root, "public/_routes.json")
    expect(existsSync(routesPath)).toBe(true)
    if (!existsSync(routesPath)) return

    const routes = JSON.parse(readFileSync(routesPath, "utf8")) as { include: string[] }
    expect(routes.include).toContain("/api/*")
  })

  it("defines a production Pages project for the Vite dist directory", () => {
    const configPath = path.join(root, "wrangler.jsonc")
    expect(existsSync(configPath)).toBe(true)
    if (!existsSync(configPath)) return

    const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>
    expect(config.name).toBe("ap-yoga-content-studio")
    expect(config.pages_build_output_dir).toBe("./dist")
    expect(config.compatibility_date).toBe("2026-07-11")
    expect(config.compatibility_flags).toEqual(["nodejs_compat"])
  })

  it("binds the production authentication D1 database and migration", () => {
    const config = JSON.parse(readFileSync(path.join(root, "wrangler.jsonc"), "utf8")) as Record<string, unknown>
    const d1 = (config.d1_databases as Array<Record<string, string>> | undefined) ?? []
    expect(d1).toHaveLength(1)
    expect(d1[0]).toMatchObject({ binding: "AUTH_DB", database_name: "ap-yoga-auth" })
    expect(d1[0].database_id).toMatch(/^[a-f0-9-]{36}$/)
    expect(readFileSync(path.join(root, "migrations/0001_auth_credentials.sql"), "utf8"))
      .toContain("CREATE TABLE IF NOT EXISTS auth_credentials")
  })

  it("builds before invoking the checked-in Wrangler CLI", () => {
    const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>
      devDependencies: Record<string, string>
    }

    expect(packageJson.scripts["predeploy:cloudflare"]).toBe("npm run build")
    expect(packageJson.scripts["deploy:cloudflare"]).toBe("wrangler pages deploy --branch master")
    expect(packageJson.scripts["typecheck:functions"]).toBe("tsc -p tsconfig.functions.json --noEmit")
    expect(packageJson.scripts.build).toBe("npm run typecheck && npm run typecheck:functions && vite build")
    expect(packageJson.devDependencies.wrangler).toMatch(/^\^4\./)
  })

  it("keeps Wrangler state and local Cloudflare secrets out of Git", () => {
    const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8")
    expect(gitignore).toContain(".wrangler/")
    expect(gitignore).toContain(".dev.vars")
  })
})
