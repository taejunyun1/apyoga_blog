<script setup lang="ts">
import { ref } from "vue"
import { useAuthStore } from "./auth-store"

const props = defineProps<{ redirect?: (destination: string) => void }>()
const emit = defineEmits<{ error: [message: string] }>()
const auth = useAuthStore()
const busy = ref(false)

async function logout() {
  if (busy.value) return
  busy.value = true
  try {
    await auth.logout()
    if ("caches" in window) {
      const names = await window.caches.keys()
      await Promise.all(names.map((name) => window.caches.delete(name)))
    }
    const redirect = props.redirect ?? ((destination: string) => window.location.assign(destination))
    redirect("/login")
  } catch {
    emit("error", "로그아웃하지 못했어요. 다시 시도해 주세요.")
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <button class="logout-button" type="button" :disabled="busy" @click="logout">
    {{ busy ? "로그아웃 중…" : "로그아웃" }}
  </button>
</template>
