import { defineStore } from "pinia"
import { ref } from "vue"
import { BrowserAuthClient, type AuthClient } from "./auth-client"

let client: AuthClient = new BrowserAuthClient()

export function configureAuthClient(value: AuthClient) {
  client = value
}

export function resetAuthClient() {
  client = new BrowserAuthClient()
}

export const useAuthStore = defineStore("auth", () => {
  const status = ref<"checking" | "authenticated" | "unauthenticated">("checking")
  let sessionRequest: Promise<boolean> | null = null

  function check() {
    if (sessionRequest) return sessionRequest

    status.value = "checking"
    const request = (async () => {
      try {
        status.value = await client.session() ? "authenticated" : "unauthenticated"
      } catch {
        status.value = "unauthenticated"
      } finally {
        sessionRequest = null
      }
      return status.value === "authenticated"
    })()
    sessionRequest = request
    return request
  }

  async function login(username: string, password: string) {
    await client.login(username, password)
    status.value = "authenticated"
  }

  async function logout() {
    await client.logout()
    status.value = "unauthenticated"
  }

  async function changePassword(currentPassword: string, newPassword: string) {
    await client.changePassword(currentPassword, newPassword)
    status.value = "unauthenticated"
  }

  return { status, check, login, logout, changePassword }
})
