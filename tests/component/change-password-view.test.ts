import { flushPromises, mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createMemoryHistory, createRouter } from "vue-router"
import { BrowserAuthClient, type AuthClient } from "@/features/auth/auth-client"
import {
  configureAuthClient,
  resetAuthClient,
  useAuthStore
} from "@/features/auth/auth-store"
import ChangePasswordView from "@/views/ChangePasswordView.vue"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function authClient(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    session: vi.fn().mockResolvedValue(true),
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    changePassword: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

async function mountChangePassword(client: AuthClient = authClient()) {
  configureAuthClient(client)
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.status = "authenticated"
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<p>Home</p>" } },
      { path: "/login", name: "login", component: { template: "<p>Login</p>" } },
      { path: "/account/password", name: "change-password", component: ChangePasswordView }
    ]
  })
  await router.push("/account/password")
  await router.isReady()
  const wrapper = mount(ChangePasswordView, { global: { plugins: [pinia, router] } })
  return { auth, router, wrapper }
}

async function fillPasswords(
  wrapper: Awaited<ReturnType<typeof mountChangePassword>>["wrapper"],
  values = ["test-password", "new-password-123", "new-password-123"]
) {
  await wrapper.get("[name=currentPassword]").setValue(values[0])
  await wrapper.get("[name=newPassword]").setValue(values[1])
  await wrapper.get("[name=confirmPassword]").setValue(values[2])
}

function passwordValues(wrapper: Awaited<ReturnType<typeof mountChangePassword>>["wrapper"]) {
  return ["currentPassword", "newPassword", "confirmPassword"].map(
    (name) => (wrapper.get(`[name=${name}]`).element as HTMLInputElement).value
  )
}

afterEach(() => {
  resetAuthClient()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("browser password-change client", () => {
  it("posts both passwords as same-origin JSON", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetch)

    await new BrowserAuthClient().changePassword("test-password", "new-password-123")

    expect(fetch).toHaveBeenCalledWith("/api/auth/password", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: "test-password", newPassword: "new-password-123" })
    })
  })

  it("surfaces the shared server response message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: "현재 비밀번호를 확인해 주세요." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    )))

    await expect(new BrowserAuthClient().changePassword("wrong-password", "new-password-123"))
      .rejects.toThrow("현재 비밀번호를 확인해 주세요.")
  })
})

describe("password-change view", () => {
  it("labels constrained password-manager fields and provides a home cancel link", async () => {
    const { wrapper } = await mountChangePassword()

    expect(wrapper.get("h1").text()).toBe("비밀번호 변경")
    expect(wrapper.get("label[for=current-password]").text()).toContain("현재 비밀번호")
    expect(wrapper.get("label[for=new-password]").text()).toContain("새 비밀번호")
    expect(wrapper.get("label[for=confirm-password]").text()).toContain("새 비밀번호 확인")
    expect(wrapper.get("[name=currentPassword]").attributes("autocomplete")).toBe("current-password")
    expect(wrapper.get("[name=newPassword]").attributes("autocomplete")).toBe("new-password")
    expect(wrapper.get("[name=confirmPassword]").attributes("autocomplete")).toBe("new-password")
    for (const name of ["currentPassword", "newPassword", "confirmPassword"]) {
      expect(wrapper.get(`[name=${name}]`).attributes()).toMatchObject({
        type: "password",
        required: "",
        minlength: "12",
        maxlength: "256"
      })
    }
    expect(wrapper.get('a[href="/"]').text()).toBe("취소")
  })

  it("rejects a confirmation mismatch without a request and clears every password", async () => {
    const changePassword = vi.fn().mockResolvedValue(undefined)
    const { wrapper } = await mountChangePassword(authClient({ changePassword }))
    await fillPasswords(wrapper, ["test-password", "new-password-123", "different-password"])

    await wrapper.get("form").trigger("submit")

    expect(changePassword).not.toHaveBeenCalled()
    expect(wrapper.get("[role=alert]").text()).toBe("새 비밀번호 확인이 일치하지 않아요.")
    expect(passwordValues(wrapper)).toEqual(["", "", ""])
  })

  it("invalidates local auth, redirects to login notice, and preserves IndexedDB on success", async () => {
    const changePassword = vi.fn().mockResolvedValue(undefined)
    const deleteDatabase = vi.spyOn(indexedDB, "deleteDatabase")
    const { auth, router, wrapper } = await mountChangePassword(authClient({ changePassword }))
    await fillPasswords(wrapper)

    await wrapper.get("form").trigger("submit")
    await flushPromises()

    expect(changePassword).toHaveBeenCalledWith("test-password", "new-password-123")
    expect(auth.status).toBe("unauthenticated")
    expect(router.currentRoute.value.fullPath).toBe("/login?password=changed")
    expect(indexedDB.deleteDatabase).not.toHaveBeenCalled()
    expect(passwordValues(wrapper)).toEqual(["", "", ""])
  })

  it("disables all passwords and announces progress while the request is pending", async () => {
    const pending = deferred<void>()
    const { wrapper } = await mountChangePassword(authClient({ changePassword: vi.fn(() => pending.promise) }))
    await fillPasswords(wrapper)

    await wrapper.get("form").trigger("submit")

    for (const name of ["currentPassword", "newPassword", "confirmPassword"]) {
      expect(wrapper.get(`[name=${name}]`).attributes("disabled")).toBeDefined()
    }
    expect(wrapper.get("button[type=submit]").attributes("disabled")).toBeDefined()
    expect(wrapper.get("[role=status]").text()).toBe("비밀번호 변경 중…")

    pending.resolve()
    await flushPromises()
  })

  it("announces a server error and clears every password", async () => {
    const message = "현재 비밀번호를 확인해 주세요."
    const { wrapper } = await mountChangePassword(authClient({
      changePassword: vi.fn().mockRejectedValue(new Error(message))
    }))
    await fillPasswords(wrapper)

    await wrapper.get("form").trigger("submit")
    await flushPromises()

    expect(wrapper.get("[role=alert]").text()).toBe(message)
    expect(passwordValues(wrapper)).toEqual(["", "", ""])
    expect(wrapper.get("button[type=submit]").attributes("disabled")).toBeUndefined()
  })
})
