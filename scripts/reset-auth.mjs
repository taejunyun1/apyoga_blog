import { spawnSync } from "node:child_process"
import { pbkdf2Sync, randomBytes } from "node:crypto"
import readline from "node:readline"
import { pathToFileURL } from "node:url"

function readLine(prompt) {
  return new Promise((resolve) => {
    const input = readline.createInterface({ input: process.stdin, output: process.stdout })
    input.question(prompt, (value) => {
      input.close()
      resolve(value)
    })
  })
}

function readHidden(prompt) {
  process.stdout.write(prompt)
  readline.emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  process.stdin.resume()

  return new Promise((resolve, reject) => {
    let value = ""
    const finish = () => {
      process.stdin.off("keypress", onKey)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdout.write("\n")
    }
    const onKey = (text, key) => {
      if (key.ctrl && key.name === "c") {
        finish()
        reject(new Error("취소되었습니다."))
        return
      }
      if (key.name === "return") {
        finish()
        resolve(value)
        return
      }
      if (key.name === "backspace") {
        if (value.length > 0) {
          value = value.slice(0, -1)
          process.stdout.write("\b \b")
        }
        return
      }
      if (text && !key.ctrl && !key.meta) {
        value += text
        process.stdout.write("*")
      }
    }
    process.stdin.on("keypress", onKey)
  })
}

function putSecret(spawn, name, value) {
  const result = spawn("npx", ["wrangler", "pages", "secret", "put", name, "--project-name", "ap-yoga-content-studio"], {
    input: `${value}\n`, stdio: ["pipe", "inherit", "inherit"], encoding: "utf8",
  })

  if (result.error || result.status !== 0) throw new Error(`${name} 등록에 실패했습니다.`)
}

function deploy(spawn) {
  const result = spawn("npm", ["run", "deploy:cloudflare"], { stdio: "inherit", encoding: "utf8" })
  if (result.error || result.status !== 0) {
    throw new Error("배포에 실패했습니다. D1 override는 유지되었습니다.")
  }
}

function removeCredentialOverride(spawn) {
  const result = spawn("npx", [
    "wrangler", "d1", "execute", "ap-yoga-auth", "--remote", "--command",
    "DELETE FROM auth_credentials WHERE id = 1",
  ], { stdio: "inherit", encoding: "utf8" })

  if (result.error || result.status !== 0) {
    throw new Error("D1 override 삭제에 실패했습니다. 원인을 해결한 뒤 auth:reset을 다시 실행해 주세요.")
  }
}

async function verifyCanonicalLogin(username, password, fetcher, timeoutSignal) {
  const productionOrigin = "https://ap-yoga-content-studio.pages.dev"
  const loginResponse = await fetcher(`${productionOrigin}/api/auth/login`, {
    method: "POST",
    headers: { Origin: productionOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    signal: timeoutSignal(),
  })
  if (loginResponse.status !== 204) {
    throw new Error(`프로덕션 로그인 확인에 실패했습니다 (HTTP ${loginResponse.status}).`)
  }

  const cookie = loginResponse.headers.get("set-cookie")?.split(";", 1)[0]
  const headers = { Origin: productionOrigin, "Content-Type": "application/json" }
  if (cookie) headers.Cookie = cookie
  const logoutResponse = await fetcher(`${productionOrigin}/api/auth/logout`, {
    method: "POST",
    headers,
    body: "{}",
    signal: timeoutSignal(),
  })
  if (logoutResponse.status !== 204) {
    throw new Error(`확인 세션 로그아웃에 실패했습니다 (HTTP ${logoutResponse.status}).`)
  }
}

export async function resetAdministrator(dependencies) {
  if (!dependencies.inputIsTTY || !dependencies.outputIsTTY) {
    throw new Error("대화형 터미널에서 실행해 주세요.")
  }

  let password = ""
  let confirmation = ""
  let passwordHash = ""
  let sessionSecret = ""

  try {
    const username = String(await dependencies.readUsername()).trim()
    password = String(await dependencies.readHidden("새 비밀번호: "))
    confirmation = String(await dependencies.readHidden("새 비밀번호 확인: "))

    if (!username) throw new Error("관리자 아이디를 입력해 주세요.")
    if (!password || !confirmation) throw new Error("새 비밀번호와 확인 값을 입력해 주세요.")
    if (password !== confirmation) throw new Error("새 비밀번호와 확인 값이 일치하지 않습니다.")
    if (password.length < 12) throw new Error("새 비밀번호는 12자 이상으로 입력해 주세요.")
    if (password.length > 256) throw new Error("새 비밀번호는 256자 이하로 입력해 주세요.")

    const salt = dependencies.randomBytes(16)
    const derived = dependencies.pbkdf2Sync(password, salt, 100_000, 32, "sha256")
    passwordHash = `pbkdf2-sha256$100000$${salt.toString("base64url")}$${derived.toString("base64url")}`
    sessionSecret = dependencies.randomBytes(32).toString("base64url")

    putSecret(dependencies.spawnSync, "AUTH_PASSWORD_HASH", passwordHash)
    putSecret(dependencies.spawnSync, "SESSION_SECRET", sessionSecret)
    deploy(dependencies.spawnSync)
    removeCredentialOverride(dependencies.spawnSync)
    await verifyCanonicalLogin(username, password, dependencies.fetch, dependencies.timeoutSignal)
    dependencies.writeOutput("관리자 비밀번호 초기화 완료\n")
  } finally {
    password = "\0".repeat(password.length)
    confirmation = "\0".repeat(confirmation.length)
    passwordHash = "\0".repeat(passwordHash.length)
    sessionSecret = "\0".repeat(sessionSecret.length)
  }
}

async function main() {
  try {
    await resetAdministrator({
      inputIsTTY: Boolean(process.stdin.isTTY),
      outputIsTTY: Boolean(process.stdout.isTTY),
      readUsername: () => readLine("관리자 아이디: "),
      readHidden,
      spawnSync,
      fetch: globalThis.fetch,
      randomBytes,
      pbkdf2Sync,
      timeoutSignal: () => AbortSignal.timeout(15_000),
      writeOutput: (value) => process.stdout.write(value),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다."
    process.stderr.write(`관리자 비밀번호 초기화 실패: ${message}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
