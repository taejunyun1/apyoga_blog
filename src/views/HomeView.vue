<script setup lang="ts">
import { onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import LogoutButton from "@/features/auth/LogoutButton.vue"
import { useStudioStore } from "@/features/studio/studio-store"

const router = useRouter()
const store = useStudioStore()
const logoutError = ref<string | null>(null)

onMounted(() => store.loadHome())

async function startDraft() {
  const draft = await store.create()
  await router.push(`/studio/${draft.id}`)
}

function readableDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
}
</script>

<template>
  <main class="app-page">
    <div class="app-content">
      <header class="brand-lockup">
        <div class="brand-lockup__identity">
          <img src="/app-icon.svg" alt="" />
          <h1>A.P YOGA Content Studio</h1>
        </div>
        <LogoutButton @error="logoutError = $event" />
      </header>
      <p v-if="logoutError" class="auth-error logout-error" role="alert">{{ logoutError }}</p>

      <button class="primary-action" type="button" @click="startDraft">
        새 글 만들기
      </button>
      <p class="lead">최대 10장 사진과 짧은 메모로 두 채널 콘텐츠를 만들어요.</p>

      <section class="section-block" aria-labelledby="draft-heading">
        <h2 id="draft-heading" class="section-title">작성 중인 글</h2>
        <div v-if="store.drafts.length === 0" class="empty-row">저장된 임시 글이 없습니다.</div>
        <div v-else class="content-list">
          <RouterLink
            v-for="draft in store.drafts"
            :key="draft.id"
            class="content-row"
            :to="`/studio/${draft.id}`"
            :aria-label="`${draft.title} 이어서 작성`"
          >
            <span>
              <strong>{{ draft.title }}</strong>
              <small>수정 중 · {{ readableDate(draft.updatedAt) }}</small>
            </span>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg>
          </RouterLink>
        </div>
      </section>

      <section class="section-block" aria-labelledby="history-heading">
        <h2 id="history-heading" class="section-title">최근 작성 기록</h2>
        <div v-if="store.history.length === 0" class="empty-row">완료한 콘텐츠가 이곳에 표시됩니다.</div>
        <div v-else class="content-list">
          <RouterLink v-for="item in store.history" :key="item.id" class="content-row" :to="`/studio/${item.id}`">
            <span>
              <strong>{{ item.title }}</strong>
              <small>완료 · {{ readableDate(item.finalizedAt ?? item.updatedAt) }}</small>
            </span>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg>
          </RouterLink>
        </div>
      </section>

      <p class="quiet-note">로컬 기능형 MVP · 브라우저 안에서만 저장됩니다.</p>
    </div>

    <footer class="privacy-rail">
      <div class="privacy-rail__inner">
        <span class="privacy-rail__status">● {{ store.saveStatus === 'error' ? '저장 실패' : '임시 저장됨' }}</span>
        <span class="privacy-rail__note">편집 사진은 5일 후 삭제됩니다</span>
      </div>
    </footer>
  </main>
</template>
