import { spawnSync } from "node:child_process"
import { pbkdf2Sync, randomBytes } from "node:crypto"
import readline from "node:readline"

if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("대화형 터미널에서 실행해 주세요.")

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

function putSecret(name, value) {
  const result = spawnSync("npx", ["wrangler", "pages", "secret", "put", name, "--project-name", "ap-yoga-content-studio"], {
    input: `${value}\n`, stdio: ["pipe", "inherit", "inherit"], encoding: "utf8",
  })

  if (result.error || result.status !== 0) throw new Error(`${name} 등록에 실패했습니다.`)
}

function deploy() {
  const result = spawnSync("npm", ["run", "deploy:cloudflare"], { stdio: "inherit", encoding: "utf8" })
  if (result.error || result.status !== 0) {
    throw new Error("배포에 실패했습니다. D1 override는 유지되었습니다.")
  }
}

function removeCredentialOverride() {
  const result = spawnSync("npx", [
    "wrangler", "d1", "execute", "ap-yoga-auth", "--remote", "--command",
    "DELETE FROM auth_credentials WHERE id = 1",
  ], { stdio: "inherit", encoding: "utf8" })

  if (result.error || result.status !== 0) {
    throw new Error("D1 override 삭제에 실패했습니다. 원인을 해결한 뒤 auth:reset을 다시 실행해 주세요.")
  }
}

async function verifyCanonicalLogin(username, password) {
  const productionOrigin = "https://ap-yoga-content-studio.pages.dev"
  const loginResponse = await fetch(`${productionOrigin}/api/auth/login`, {
    method: "POST",
    headers: { Origin: productionOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(15_000),
  })
  if (loginResponse.status !== 204) {
    throw new Error(`프로덕션 로그인 확인에 실패했습니다 (HTTP ${loginResponse.status}).`)
  }

  const cookie = loginResponse.headers.get("set-cookie")?.split(";", 1)[0]
  const headers = { Origin: productionOrigin, "Content-Type": "application/json" }
  if (cookie) headers.Cookie = cookie
  const logoutResponse = await fetch(`${productionOrigin}/api/auth/logout`, {
    method: "POST",
    headers,
    body: "{}",
    signal: AbortSignal.timeout(15_000),
  })
  if (logoutResponse.status !== 204) {
    throw new Error(`확인 세션 로그아웃에 실패했습니다 (HTTP ${logoutResponse.status}).`)
  }
}

let password = ""
let confirmation = ""
let passwordHash = ""
let sessionSecret = ""

try {
  const username = String(await readLine("관리자 아이디: ")).trim()
  password = String(await readHidden("새 비밀번호: "))
  confirmation = String(await readHidden("새 비밀번호 확인: "))

  if (!username) throw new Error("관리자 아이디를 입력해 주세요.")
  if (!password || !confirmation) throw new Error("새 비밀번호와 확인 값을 입력해 주세요.")
  if (password !== confirmation) throw new Error("새 비밀번호와 확인 값이 일치하지 않습니다.")
  if (password.length < 12) throw new Error("새 비밀번호는 12자 이상으로 입력해 주세요.")
  if (password.length > 256) throw new Error("새 비밀번호는 256자 이하로 입력해 주세요.")

  const salt = randomBytes(16)
  const derived = pbkdf2Sync(password, salt, 100_000, 32, "sha256")
  passwordHash = `pbkdf2-sha256$100000$${salt.toString("base64url")}$${derived.toString("base64url")}`
  sessionSecret = randomBytes(32).toString("base64url")

  putSecret("AUTH_PASSWORD_HASH", passwordHash)
  putSecret("SESSION_SECRET", sessionSecret)
  deploy()
  removeCredentialOverride()
  await verifyCanonicalLogin(username, password)
  process.stdout.write("관리자 비밀번호 초기화 완료\n")
} catch (error) {
  const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다."
  process.stderr.write(`관리자 비밀번호 초기화 실패: ${message}\n`)
  process.exitCode = 1
} finally {
  password = "\0".repeat(password.length)
  confirmation = "\0".repeat(confirmation.length)
  passwordHash = "\0".repeat(passwordHash.length)
  sessionSecret = "\0".repeat(sessionSecret.length)
}
