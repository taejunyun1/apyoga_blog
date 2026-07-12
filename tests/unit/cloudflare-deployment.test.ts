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

  it("documents mandatory AUTH_DB provisioning, migration, safe inspection, and deploy order", () => {
    const readme = readFileSync(path.join(root, "README.md"), "utf8")
    const create = "npx wrangler d1 create ap-yoga-auth --location apac"
    const list = "npx wrangler d1 list --json"
    const localMigration = "npx wrangler d1 migrations apply ap-yoga-auth --local"
    const remoteMigration = "npx wrangler d1 migrations apply ap-yoga-auth --remote"
    const safeQuery = "SELECT id, credential_version, updated_at FROM auth_credentials"
    const deploy = "npm run deploy:cloudflare"

    expect(readme).toContain("AUTH_DB")
    expect(readme).toContain(create)
    expect(readme).toContain(list)
    expect(readme).toContain(localMigration)
    expect(readme).toContain(remoteMigration)
    expect(readme).toContain(safeQuery)
    expect(readme).toContain("콘텐츠·이미지의 D1/R2 서버 저장")
    expect(readme.indexOf(localMigration)).toBeLessThan(readme.indexOf(remoteMigration))
    expect(readme.indexOf(remoteMigration)).toBeLessThan(readme.indexOf(deploy))
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
