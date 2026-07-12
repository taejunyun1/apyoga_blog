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
  const result = spawnSync(
    "npx",
    ["wrangler", "pages", "secret", "put", name, "--project-name", "ap-yoga-content-studio"],
    {
      input: `${value}\n`,
      stdio: ["pipe", "inherit", "inherit"],
      encoding: "utf8",
    },
  )

  if (result.status !== 0) throw new Error(`${name} 등록에 실패했습니다.`)
  process.stdout.write(`${name} 등록 완료\n`)
}

const username = String(await readLine("아이디: ")).trim()
let password = ""

try {
  password = String(await readHidden("비밀번호: "))
  if (!username || !password) throw new Error("아이디와 비밀번호를 입력해 주세요.")
  if (password.length > 256) throw new Error("비밀번호는 256자 이하로 입력해 주세요.")

  const salt = randomBytes(16)
  const derived = pbkdf2Sync(password, salt, 600_000, 32, "sha256")
  const passwordHash = `pbkdf2-sha256$600000$${salt.toString("base64url")}$${derived.toString("base64url")}`
  const sessionSecret = randomBytes(32).toString("base64url")

  putSecret("AUTH_USERNAME", username)
  putSecret("AUTH_PASSWORD_HASH", passwordHash)
  putSecret("SESSION_SECRET", sessionSecret)
} finally {
  password = "\0".repeat(password.length)
}
