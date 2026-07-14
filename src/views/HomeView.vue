<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue"
import { useRouter } from "vue-router"
import LogoutButton from "@/features/auth/LogoutButton.vue"
import HistoryDeleteDialog from "@/features/studio/HistoryDeleteDialog.vue"
import { useStudioStore } from "@/features/studio/studio-store"

const router = useRouter()
const store = useStudioStore()
const logoutError = ref<string | null>(null)
type DeleteTarget =
  | { kind: "one"; id: string; title: string }
  | { kind: "all"; count: number }

const deleteTarget = ref<DeleteTarget | null>(null)
const deleting = ref(false)
const deleteError = ref<string | null>(null)
const toastMessage = ref<string | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null

const deleteDialogTitle = computed(() => deleteTarget.value?.kind === "all" ? "모든 기록 삭제" : "기록 삭제")
const deleteDialogDescription = computed(() => {
  const target = deleteTarget.value
  if (!target) return ""
  return target.kind === "all"
    ? `저장된 기록 ${target.count}개를 모두 삭제할까요?`
    : `“${target.title}” 기록을 삭제할까요?`
})

onMounted(() => store.loadHome())
onUnmounted(() => {
  if (toastTimer) clearTimeout(toastTimer)
})

async function startDraft() {
  const draft = await store.create()
  await router.push(`/studio/${draft.id}`)
}

function readableDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
}

function requestDelete(id: string, title: string) {
  deleteError.value = null
  deleteTarget.value = { kind: "one", id, title }
}

function requestClearHistory() {
  deleteError.value = null
  deleteTarget.value = { kind: "all", count: store.history.length }
}

function closeDeleteDialog() {
  if (deleting.value) return
  deleteError.value = null
  deleteTarget.value = null
}

function showToast(message: string) {
  if (toastTimer) clearTimeout(toastTimer)
  toastMessage.value = message
  toastTimer = setTimeout(() => {
    toastMessage.value = null
    toastTimer = null
  }, 2500)
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (!target || deleting.value) return
  deleting.value = true
  deleteError.value = null
  try {
    if (target.kind === "one") {
      await store.deleteHistory(target.id)
      showToast("기록을 삭제했어요")
    } else {
      await store.clearHistory()
      showToast("모든 기록을 삭제했어요")
    }
    deleteTarget.value = null
  } catch (error) {
    deleteError.value = error instanceof Error ? error.message : "기록을 삭제하지 못했어요. 다시 시도해 주세요."
  } finally {
    deleting.value = false
  }
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
        <div class="brand-lockup__actions">
          <RouterLink class="header-action" to="/account/password">비밀번호 변경</RouterLink>
          <LogoutButton @error="logoutError = $event" />
        </div>
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
        <div class="history-section-heading">
          <h2 id="history-heading" class="section-title">최근 작성 기록</h2>
          <button v-if="store.history.length > 0" type="button" class="history-clear-button" @click="requestClearHistory">
            전체 삭제
          </button>
        </div>
        <div v-if="store.history.length === 0" class="empty-row">완료한 콘텐츠가 이곳에 표시됩니다.</div>
        <div v-else class="content-list">
          <div v-for="item in store.history" :key="item.id" class="content-row content-row--actionable">
            <RouterLink class="content-row__link" :to="`/studio/${item.id}`">
              <span>
                <strong>{{ item.title }}</strong>
                <small>완료 · {{ readableDate(item.finalizedAt ?? item.updatedAt) }}</small>
              </span>
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg>
            </RouterLink>
            <button
              type="button"
              class="history-delete-button"
              :aria-label="`${item.title} 삭제`"
              @click="requestDelete(item.id, item.title)"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5" />
              </svg>
            </button>
          </div>
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

    <HistoryDeleteDialog
      :open="deleteTarget !== null"
      :title="deleteDialogTitle"
      :description="deleteDialogDescription"
      :busy="deleting"
      :error="deleteError"
      @cancel="closeDeleteDialog"
      @confirm="confirmDelete"
    />

    <Transition name="toast">
      <p v-if="toastMessage" class="action-toast history-action-toast" role="status" aria-live="polite">{{ toastMessage }}</p>
    </Transition>
  </main>
</template>
