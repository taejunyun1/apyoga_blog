export interface AuthClient {
  session(): Promise<boolean>
  login(username: string, password: string): Promise<void>
  logout(): Promise<void>
}

async function message(response: Response): Promise<string> {
  return response
    .json()
    .then((value: { message?: string }) => value.message ?? "요청을 처리하지 못했어요.")
    .catch(() => "요청을 처리하지 못했어요.")
}

export class BrowserAuthClient implements AuthClient {
  async session() {
    return fetch("/api/auth/session", {
      credentials: "same-origin",
      cache: "no-store"
    }).then((response) => response.ok)
  }

  async login(username: string, password: string) {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    })
    if (!response.ok) throw new Error(await message(response))
  }

  async logout() {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    })
    if (!response.ok) throw new Error(await message(response))
  }
}
