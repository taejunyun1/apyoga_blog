import { flushPromises, mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createMemoryHistory, createRouter } from "vue-router"
import { createDraft } from "@/domain/studio"
import { configureAuthClient, resetAuthClient } from "@/features/auth/auth-store"
import type { AuthClient } from "@/features/auth/auth-client"
import LogoutButton from "@/features/auth/LogoutButton.vue"
import { configureStudioServices, resetStudioServices, useStudioStore } from "@/features/studio/studio-store"
import HomeView from "@/views/HomeView.vue"
import LoginView from "@/views/LoginView.vue"
import StudioView from "@/views/StudioView.vue"
import { InMemoryRepository } from "../helpers/in-memory-repository"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function authClient(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    session: vi.fn().mockResolvedValue(false),
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    changePassword: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

async function mountLogin(next?: string, password?: string) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/login", component: LoginView },
      { path: "/", component: { template: "<p>Home</p>" } },
      { path: "/studio/:draftId", component: { template: "<p>Studio</p>" } }
    ]
  })
  await router.push({
    path: "/login",
    query: {
      ...(next === undefined ? {} : { next }),
      ...(password === undefined ? {} : { password })
    }
  })
  await router.isReady()
  return { wrapper: mount(LoginView, { global: { plugins: [pinia, router] } }), router }
}

afterEach(() => {
  resetAuthClient()
  resetStudioServices()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("login view", () => {
  it("submits the branded form and follows the safe next route", async () => {
    const login = vi.fn().mockResolvedValue(undefined)
    configureAuthClient(authClient({ login }))
    const { wrapper, router } = await mountLogin("/studio/draft-1")

    await wrapper.get("[name=username]").setValue("studio-user")
    await wrapper.get("[name=password]").setValue("test-password")
    await wrapper.get("form").trigger("submit")
    await flushPromises()

    expect(login).toHaveBeenCalledWith("studio-user", "test-password")
    expect(router.currentRoute.value.fullPath).toBe("/studio/draft-1")
  })

  it("labels both required credential fields for password managers and assistive technology", async () => {
    configureAuthClient(authClient())
    const { wrapper } = await mountLogin()

    expect(wrapper.get("h1").text()).toBe("Content Studio 로그인")
    expect(wrapper.get("label[for=auth-username]").text()).toContain("아이디")
    expect(wrapper.get("[name=username]").attributes()).toMatchObject({ autocomplete: "username", required: "" })
    expect(wrapper.get("label[for=auth-password]").text()).toContain("비밀번호")
    expect(wrapper.get("[name=password]").attributes()).toMatchObject({ autocomplete: "current-password", required: "", type: "password" })
    expect(wrapper.get("form").attributes("aria-describedby")).toBe("login-description")
  })

  it("disables the form and announces progress while login is pending", async () => {
    const pending = deferred<void>()
    configureAuthClient(authClient({ login: vi.fn(() => pending.promise) }))
    const { wrapper } = await mountLogin()
    await wrapper.get("[name=username]").setValue("studio-user")
    await wrapper.get("[name=password]").setValue("test-password")

    await wrapper.get("form").trigger("submit")

    expect(wrapper.get("[name=username]").attributes("disabled")).toBeDefined()
    expect(wrapper.get("[name=password]").attributes("disabled")).toBeDefined()
    expect(wrapper.get("button[type=submit]").attributes("disabled")).toBeDefined()
    expect(wrapper.get("button[type=submit]").text()).toBe("로그인 중…")

    pending.resolve()
    await flushPromises()
  })

  it("announces the generic invalid-credentials error and clears the password", async () => {
    const message = "아이디 또는 비밀번호를 확인해 주세요."
    configureAuthClient(authClient({ login: vi.fn().mockRejectedValue(new Error(message)) }))
    const { wrapper } = await mountLogin()
    await wrapper.get("[name=username]").setValue("studio-user")
    await wrapper.get("[name=password]").setValue("wrong-password")

    await wrapper.get("form").trigger("submit")
    await flushPromises()

    expect(wrapper.get("[role=alert]").text()).toBe(message)
    expect((wrapper.get("[name=password]").element as HTMLInputElement).value).toBe("")
    expect((wrapper.get("[name=username]").element as HTMLInputElement).value).toBe("studio-user")
  })

  it("renders the server lockout message unchanged", async () => {
    const message = "로그인 시도가 많아요. 10분 후 다시 시도해 주세요."
    configureAuthClient(authClient({ login: vi.fn().mockRejectedValue(new Error(message)) }))
    const { wrapper } = await mountLogin()
    await wrapper.get("[name=username]").setValue("studio-user")
    await wrapper.get("[name=password]").setValue("test-password")

    await wrapper.get("form").trigger("submit")
    await flushPromises()

    expect(wrapper.get("[role=alert]").text()).toBe(message)
  })

  it("falls back to home for a non-local next destination", async () => {
    configureAuthClient(authClient())
    const { wrapper, router } = await mountLogin("https://evil.example")
    await wrapper.get("[name=username]").setValue("studio-user")
    await wrapper.get("[name=password]").setValue("test-password")

    await wrapper.get("form").trigger("submit")
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe("/")
  })

  it("announces a completed password change and shows the terminal reset guidance", async () => {
    configureAuthClient(authClient())
    const { wrapper } = await mountLogin(undefined, "changed")

    expect(wrapper.get("[role=status]").text()).toBe("비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.")
    expect(wrapper.get("[role=status]").classes()).not.toContain("visually-hidden")
    expect(wrapper.text()).toContain("비밀번호를 잊으셨나요? 관리자 터미널에서 npm run auth:reset을 실행하세요.")
  })
})

describe("shared logout", () => {
  it("waits for server success, clears service-worker caches, and preserves IndexedDB", async () => {
    const request = deferred<void>()
    const logout = vi.fn(() => request.promise)
    const cacheKeys = vi.fn().mockResolvedValue(["app-shell", "images"])
    const deleteCache = vi.fn().mockResolvedValue(true)
    const redirect = vi.fn()
    vi.stubGlobal("caches", { keys: cacheKeys, delete: deleteCache })
    const deleteDatabase = vi.spyOn(indexedDB, "deleteDatabase")
    configureAuthClient(authClient({ logout }))
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(LogoutButton, { props: { redirect }, global: { plugins: [pinia] } })

    await wrapper.get("button").trigger("click")

    expect(wrapper.get("button").attributes("disabled")).toBeDefined()
    expect(wrapper.get("button").text()).toBe("로그아웃 중…")
    expect(cacheKeys).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()

    request.resolve()
    await flushPromises()

    expect(cacheKeys).toHaveBeenCalledOnce()
    expect(deleteCache.mock.calls.map(([name]) => name)).toEqual(["app-shell", "images"])
    expect(deleteDatabase).not.toHaveBeenCalled()
    expect(redirect).toHaveBeenCalledWith("/login")
    expect(deleteCache.mock.invocationCallOrder.at(-1)).toBeLessThan(redirect.mock.invocationCallOrder[0])
  })

  it.each(["keys", "delete"] as const)("still redirects without reporting server failure when cache %s fails", async (failure) => {
    const logout = vi.fn().mockResolvedValue(undefined)
    const cacheKeys = failure === "keys"
      ? vi.fn().mockRejectedValue(new Error("cache unavailable"))
      : vi.fn().mockResolvedValue(["app-shell"])
    const deleteCache = failure === "delete"
      ? vi.fn().mockRejectedValue(new Error("cache delete failed"))
      : vi.fn().mockResolvedValue(true)
    const redirect = vi.fn()
    vi.stubGlobal("caches", { keys: cacheKeys, delete: deleteCache })
    const deleteDatabase = vi.spyOn(indexedDB, "deleteDatabase")
    configureAuthClient(authClient({ logout }))
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(LogoutButton, { props: { redirect }, global: { plugins: [pinia] } })

    await wrapper.get("button").trigger("click")
    await flushPromises()

    expect(logout).toHaveBeenCalledOnce()
    expect(wrapper.emitted("error")).toBeUndefined()
    expect(deleteDatabase).not.toHaveBeenCalled()
    expect(redirect).toHaveBeenCalledWith("/login")
  })

  it("falls back to router replacement when hard navigation rejects", async () => {
    configureAuthClient(authClient())
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/private", component: { template: "<p>Private</p>" } },
        { path: "/login", component: { template: "<p>Login</p>" } }
      ]
    })
    await router.push("/private")
    await router.isReady()
    const redirect = vi.fn().mockRejectedValue(new Error("navigation unavailable"))
    const wrapper = mount(LogoutButton, { props: { redirect }, global: { plugins: [pinia, router] } })

    await wrapper.get("button").trigger("click")
    await flushPromises()

    expect(redirect).toHaveBeenCalledWith("/login")
    expect(router.currentRoute.value.fullPath).toBe("/login")
    expect(wrapper.emitted("error")).toBeUndefined()
  })

  it("emits an error without clearing local data when server logout fails", async () => {
    const cacheKeys = vi.fn()
    vi.stubGlobal("caches", { keys: cacheKeys, delete: vi.fn() })
    configureAuthClient(authClient({ logout: vi.fn().mockRejectedValue(new Error("offline")) }))
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(LogoutButton, { global: { plugins: [pinia] } })

    await wrapper.get("button").trigger("click")
    await flushPromises()

    expect(wrapper.emitted("error")).toEqual([["로그아웃하지 못했어요. 다시 시도해 주세요."]])
    expect(cacheKeys).not.toHaveBeenCalled()
    expect(wrapper.get("button").attributes("disabled")).toBeUndefined()
    expect(wrapper.get("button").text()).toBe("로그아웃")
  })

  it("surfaces logout failure in the home header", async () => {
    configureAuthClient(authClient({ logout: vi.fn().mockRejectedValue(new Error("offline")) }))
    const repository = new InMemoryRepository()
    configureStudioServices({ repository })
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: HomeView }]
    })
    await router.push("/")
    await router.isReady()
    const wrapper = mount(HomeView, { global: { plugins: [pinia, router] } })

    await wrapper.get(".logout-button").trigger("click")
    await flushPromises()

    expect(wrapper.get("[role=alert]").text()).toBe("로그아웃하지 못했어요. 다시 시도해 주세요.")
  })

  it("surfaces logout failure in the studio header", async () => {
    configureAuthClient(authClient({ logout: vi.fn().mockRejectedValue(new Error("offline")) }))
    const repository = new InMemoryRepository()
    configureStudioServices({ repository })
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    const draft = createDraft()
    store.draft = draft
    repository.drafts.set(draft.id, draft)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/studio/:draftId", component: StudioView }]
    })
    await router.push(`/studio/${draft.id}`)
    await router.isReady()
    const wrapper = mount(StudioView, { global: { plugins: [pinia, router] } })

    await wrapper.get(".logout-button").trigger("click")
    await flushPromises()

    expect(wrapper.get("[role=alert]").text()).toContain("로그아웃하지 못했어요. 다시 시도해 주세요.")
  })
})
