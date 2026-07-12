import { spawnSync } from "node:child_process"
import readline from "node:readline"

if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("대화형 터미널에서 실행해 주세요.")

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

let apiKey = ""

try {
  apiKey = String(await readHidden("OpenAI API key: "))
  if (!apiKey) throw new Error("OpenAI API key를 입력해 주세요.")
  if (apiKey.length > 512) throw new Error("OpenAI API key는 512자 이하로 입력해 주세요.")

  const result = spawnSync(
    "npx",
    ["wrangler", "pages", "secret", "put", "OPENAI_API_KEY", "--project-name", "ap-yoga-content-studio"],
    { input: `${apiKey}\n`, stdio: ["pipe", "inherit", "inherit"], encoding: "utf8" },
  )

  if (result.status !== 0) throw new Error("OPENAI_API_KEY 등록에 실패했습니다.")
  process.stdout.write("OPENAI_API_KEY 등록 완료\n")
} finally {
  apiKey = "\0".repeat(apiKey.length)
}
