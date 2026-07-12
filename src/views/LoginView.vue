<script setup lang="ts">
import { ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import { useAuthStore } from "@/features/auth/auth-store"

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const username = ref("")
const password = ref("")
const busy = ref(false)
const error = ref<string | null>(null)

async function submit() {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    await auth.login(username.value, password.value)
    const requested = Array.isArray(route.query.next) ? route.query.next[0] : route.query.next
    const destination = typeof requested === "string" && requested.startsWith("/") && !requested.startsWith("//")
      ? requested
      : "/"
    await router.replace(destination)
  } catch (reason) {
    password.value = ""
    error.value = reason instanceof Error ? reason.message : "로그인을 처리하지 못했어요."
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-card" aria-labelledby="login-heading">
      <header class="auth-brand">
        <img src="/app-icon.svg" alt="" />
        <p>A.P YOGA</p>
        <h1 id="login-heading">Content Studio 로그인</h1>
        <span id="login-description">수련의 기록을 안전하게 이어가세요.</span>
        <span :class="{ 'visually-hidden': route.query.password !== 'changed' }" role="status">
          {{ route.query.password === "changed" ? "비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요." : "로그인이 필요해요." }}
        </span>
      </header>
      <form aria-describedby="login-description" :aria-busy="busy" @submit.prevent="submit">
        <label class="auth-field" for="auth-username">
          <span>아이디</span>
          <input
            id="auth-username"
            v-model="username"
            name="username"
            autocomplete="username"
            required
            :disabled="busy"
          />
        </label>
        <label class="auth-field" for="auth-password">
          <span>비밀번호</span>
          <input
            id="auth-password"
            v-model="password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
            :disabled="busy"
          />
        </label>
        <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
        <button class="primary-action" type="submit" :disabled="busy">
          {{ busy ? "로그인 중…" : "로그인" }}
        </button>
      </form>
      <p class="quiet-note password-help">비밀번호를 잊으셨나요? 관리자 터미널에서 npm run auth:reset을 실행하세요.</p>
    </section>
  </main>
</template>
