<script setup lang="ts">
import { inject, ref } from "vue"
import { routerKey } from "vue-router"
import { useAuthStore } from "./auth-store"

const props = defineProps<{ redirect?: (destination: string) => void | Promise<void> }>()
const emit = defineEmits<{ error: [message: string] }>()
const auth = useAuthStore()
const router = inject(routerKey, null)
const busy = ref(false)

async function clearServiceWorkerCaches() {
  if (!("caches" in window)) return
  try {
    const names = await window.caches.keys()
    await Promise.all(names.map((name) => window.caches.delete(name)))
  } catch {
    // The server session is already closed; stale caches must not keep the private UI open.
  }
}

async function leavePrivateScreen() {
  const redirect = props.redirect ?? ((destination: string) => window.location.assign(destination))
  try {
    await redirect("/login")
  } catch {
    try {
      await router?.replace("/login")
    } catch {
      // Server logout succeeded, so navigation failure is not a server logout error.
    }
  }
}

async function logout() {
  if (busy.value) return
  busy.value = true
  try {
    await auth.logout()
  } catch {
    emit("error", "로그아웃하지 못했어요. 다시 시도해 주세요.")
    busy.value = false
    return
  }

  await clearServiceWorkerCaches()
  await leavePrivateScreen()
  busy.value = false
}
</script>

<template>
  <button class="logout-button" type="button" :disabled="busy" @click="logout">
    {{ busy ? "로그아웃 중…" : "로그아웃" }}
  </button>
</template>
