import { flushPromises, mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createMemoryHistory } from "vue-router"
import App from "@/app/App.vue"
import { createAppRouter } from "@/app/router"
import {
  configureAuthClient,
  resetAuthClient,
  useAuthStore
} from "@/features/auth/auth-store"
import type { AuthClient } from "@/features/auth/auth-client"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function clientWith(session: AuthClient["session"]): AuthClient {
  return {
    session,
    login: vi.fn(),
    logout: vi.fn(),
    changePassword: vi.fn().mockResolvedValue(undefined)
  }
}

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined)
})

afterEach(() => {
  resetAuthClient()
  vi.restoreAllMocks()
})

describe("authentication routing", () => {
  it("does not initialize or render a private view before the session check resolves", async () => {
    const session = deferred<boolean>()
    const openDatabase = vi.spyOn(indexedDB, "open")
    configureAuthClient(clientWith(() => session.promise))
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter(createMemoryHistory())
    void router.push("/")

    const wrapper = mount(App, { global: { plugins: [pinia, router] } })

    expect(wrapper.text()).toContain("로그인 상태 확인 중")
    expect(wrapper.text()).not.toContain("새 글 만들기")
    expect(openDatabase).not.toHaveBeenCalled()

    session.resolve(false)
    await router.isReady()
    await flushPromises()

    expect(router.currentRoute.value.name).toBe("login")
    expect(wrapper.text()).toContain("로그인이 필요해요.")
    expect(wrapper.text()).not.toContain("새 글 만들기")
    expect(openDatabase).not.toHaveBeenCalled()
  })

  it("renders the home view only after a live authenticated session succeeds", async () => {
    const session = deferred<boolean>()
    configureAuthClient(clientWith(() => session.promise))
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter(createMemoryHistory())
    void router.push("/")
    const wrapper = mount(App, { global: { plugins: [pinia, router] } })

    expect(wrapper.text()).not.toContain("새 글 만들기")

    session.resolve(true)
    await router.isReady()
    await flushPromises()

    expect(router.currentRoute.value.name).toBe("home")
    expect(wrapper.text()).toContain("새 글 만들기")
    expect(wrapper.get('a[href="/account/password"]').text()).toBe("비밀번호 변경")
  })

  it("protects the registered password-change route", async () => {
    configureAuthClient(clientWith(vi.fn().mockResolvedValue(false)))
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter(createMemoryHistory())

    await router.push("/account/password")

    expect(router.currentRoute.value.name).toBe("login")
    expect(router.currentRoute.value.query.next).toBe("/account/password")
    expect(router.resolve("/account/password").name).toBe("change-password")
  })

  it("preserves a local private destination for an unauthenticated direct visit", async () => {
    configureAuthClient(clientWith(vi.fn().mockResolvedValue(false)))
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter(createMemoryHistory())

    await router.push("/studio/draft-1?step=photos")

    expect(router.currentRoute.value.name).toBe("login")
    expect(router.currentRoute.value.query.next).toBe("/studio/draft-1?step=photos")
  })

  it("fails closed to login when the live session request fails", async () => {
    configureAuthClient(clientWith(vi.fn().mockRejectedValue(new TypeError("offline"))))
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter(createMemoryHistory())

    await router.push("/")

    expect(router.currentRoute.value.name).toBe("login")
    expect(router.currentRoute.value.query.next).toBe("/")
  })

  it("drops a non-local next destination from the public login route", async () => {
    configureAuthClient(clientWith(vi.fn().mockResolvedValue(false)))
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter(createMemoryHistory())

    await router.push({ name: "login", query: { next: "https://example.com/steal" } })

    expect(router.currentRoute.value.name).toBe("login")
    expect(router.currentRoute.value.query.next).toBeUndefined()
  })

  it("shares one in-flight live session request across concurrent checks", async () => {
    const session = deferred<boolean>()
    const sessionRequest = vi.fn(() => session.promise)
    configureAuthClient(clientWith(sessionRequest))
    setActivePinia(createPinia())
    const auth = useAuthStore()

    const first = auth.check()
    const second = auth.check()

    expect(sessionRequest).toHaveBeenCalledTimes(1)
    session.resolve(true)
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(auth.status).toBe("authenticated")
  })
})
