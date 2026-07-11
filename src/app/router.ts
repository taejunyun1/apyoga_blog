import { createRouter, createWebHistory, type RouterHistory } from "vue-router"
import { useAuthStore } from "@/features/auth/auth-store"
import LoginView from "@/views/LoginView.vue"

function localNext(value: unknown): string | undefined {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : undefined
}

export function createAppRouter(history: RouterHistory = createWebHistory()) {
  const router = createRouter({
    history,
    routes: [
      { path: "/login", name: "login", component: LoginView, meta: { public: true } },
      { path: "/", name: "home", component: () => import("@/views/HomeView.vue") },
      { path: "/studio/:draftId", name: "studio", component: () => import("@/views/StudioView.vue") }
    ],
    scrollBehavior: () => ({ top: 0 })
  })

  router.beforeEach(async (to) => {
    const auth = useAuthStore()
    if (auth.status === "checking") await auth.check()

    if (to.meta.public) {
      if (auth.status === "authenticated") return { name: "home" }

      const next = localNext(to.query.next)
      if ("next" in to.query && next !== to.query.next) {
        return { name: "login", query: next ? { next } : {} }
      }
      return true
    }

    if (auth.status !== "authenticated") {
      const next = localNext(to.fullPath)
      return { name: "login", query: next ? { next } : {} }
    }
    return true
  })

  return router
}

export default createAppRouter()
