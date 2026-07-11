<script setup lang="ts">
import { useAuthStore } from "@/features/auth/auth-store"

const auth = useAuthStore()
</script>

<template>
  <main v-if="auth.status === 'checking'" class="auth-page">
    <p role="status">로그인 상태 확인 중…</p>
  </main>
  <RouterView v-else />
</template>
