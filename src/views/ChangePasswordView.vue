<script setup lang="ts">
import { ref } from "vue"
import { useRouter } from "vue-router"
import { useAuthStore } from "@/features/auth/auth-store"

const auth = useAuthStore()
const router = useRouter()
const currentPassword = ref("")
const newPassword = ref("")
const confirmPassword = ref("")
const busy = ref(false)
const error = ref<string | null>(null)

function clearPasswords() {
  currentPassword.value = ""
  newPassword.value = ""
  confirmPassword.value = ""
}

async function submit() {
  if (busy.value) return
  error.value = null
  if (newPassword.value !== confirmPassword.value) {
    error.value = "새 비밀번호 확인이 일치하지 않아요."
    clearPasswords()
    return
  }

  busy.value = true
  try {
    await auth.changePassword(currentPassword.value, newPassword.value)
    await router.replace({ name: "login", query: { password: "changed" } })
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "비밀번호를 변경하지 못했어요."
  } finally {
    clearPasswords()
    busy.value = false
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-card" aria-labelledby="change-password-heading">
      <header class="auth-brand">
        <img src="/app-icon.svg" alt="" />
        <p>A.P YOGA</p>
        <h1 id="change-password-heading">비밀번호 변경</h1>
        <span id="change-password-description">현재 비밀번호를 확인한 뒤 새 비밀번호를 설정하세요.</span>
      </header>
      <form aria-describedby="change-password-description" :aria-busy="busy" @submit.prevent="submit">
        <label class="auth-field" for="current-password">
          <span>현재 비밀번호</span>
          <input
            id="current-password"
            v-model="currentPassword"
            name="currentPassword"
            type="password"
            autocomplete="current-password"
            required
            minlength="12"
            maxlength="256"
            :disabled="busy"
          />
        </label>
        <label class="auth-field" for="new-password">
          <span>새 비밀번호</span>
          <input
            id="new-password"
            v-model="newPassword"
            name="newPassword"
            type="password"
            autocomplete="new-password"
            required
            minlength="12"
            maxlength="256"
            :disabled="busy"
          />
        </label>
        <label class="auth-field" for="confirm-password">
          <span>새 비밀번호 확인</span>
          <input
            id="confirm-password"
            v-model="confirmPassword"
            name="confirmPassword"
            type="password"
            autocomplete="new-password"
            required
            minlength="12"
            maxlength="256"
            :disabled="busy"
          />
        </label>
        <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
        <p v-if="busy" class="visually-hidden" role="status">비밀번호 변경 중…</p>
        <button class="primary-action" type="submit" :disabled="busy">
          {{ busy ? "변경 중…" : "비밀번호 변경" }}
        </button>
        <RouterLink class="auth-cancel" to="/">취소</RouterLink>
      </form>
    </section>
  </main>
</template>
