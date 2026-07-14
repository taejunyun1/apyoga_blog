<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import LogoutButton from "@/features/auth/LogoutButton.vue"
import BottomActionBar from "@/features/studio/BottomActionBar.vue"
import ContentBriefReview from "@/features/studio/ContentBriefReview.vue"
import ErrorBanner from "@/features/studio/ErrorBanner.vue"
import GenerationProgress from "@/features/studio/GenerationProgress.vue"
import MemoToneForm from "@/features/studio/MemoToneForm.vue"
import PhotoOrganizer from "@/features/studio/PhotoOrganizer.vue"
import PhotoUploader from "@/features/studio/PhotoUploader.vue"
import ProgressStepper from "@/features/studio/ProgressStepper.vue"
import ResultEditor from "@/features/studio/ResultEditor.vue"
import { rewriteActionKey, rewriteFeedbackFor, type RewritePreview } from "@/features/studio/rewrite-actions"
import { useAutosave } from "@/features/studio/composables/use-autosave"
import { useStudioStore } from "@/features/studio/studio-store"

const route = useRoute()
const router = useRouter()
const store = useStudioStore()
const error = ref<string | null>(null)
const copyFallback = ref<string | null>(null)
const toastMessage = ref<string | null>(null)
const toastId = ref(0)
const pendingRewriteKey = ref<string | null>(null)
const rewritePreviews = ref<Partial<Record<"naver" | "instagram", RewritePreview>>>({})
let toastTimer: ReturnType<typeof setTimeout> | null = null
const stopAutosave = useAutosave(store)

const readyImages = computed(() => store.draft?.images.filter((image) => image.status === "ready") ?? [])

onMounted(async () => {
  const draftId = String(route.params.draftId)
  if (!store.draft || store.draft.id !== draftId) {
    try { await store.load(draftId) }
    catch (reason) { error.value = reason instanceof Error ? reason.message : "글을 불러오지 못했어요." }
  }
})

onUnmounted(() => {
  stopAutosave()
  if (toastTimer) clearTimeout(toastTimer)
})

function clearToast() {
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = null
  toastMessage.value = null
}

function showToast(message: string, options: { persistent?: boolean } = {}) {
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = null
  toastMessage.value = message
  toastId.value += 1
  if (!options.persistent) {
    toastTimer = setTimeout(() => {
      toastMessage.value = null
      toastTimer = null
    }, 2400)
  }
}

async function run(action: () => Promise<unknown>, successMessage?: string) {
  error.value = null
  try {
    await action()
    if (successMessage) showToast(successMessage)
    return true
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "요청을 처리하지 못했어요."
    return false
  }
}

async function finishCurrentStep() {
  if (!store.draft) return
  if (store.draft.step === "photos") {
    await run(() => store.completePhotoSelection())
  } else if (store.draft.step === "organize") {
    store.draft.step = "memo"
    await run(() => store.saveNow())
  }
}

async function submitMemo(value: Parameters<typeof store.updateMemo>[0]) {
  if (store.busy) return
  store.updateMemo(value)
  showToast("사진과 메모를 분석하고 있어요…", { persistent: true })
  const completed = await run(() => store.analyze())
  if (completed) showToast("사진 분석이 완료됐어요")
  else clearToast()
}

async function generateChannels() {
  const completed = await run(() => store.generateAll())
  if (!completed) return
  const successCount = [store.draft?.naver.status, store.draft?.instagram.status]
    .filter((status) => status === "success").length
  if (successCount === 2) showToast("두 채널 글을 생성했어요")
  else if (successCount === 1) showToast("생성 가능한 한 채널 결과를 준비했어요")
  else error.value = "두 채널 글 생성에 실패했어요. 채널별 다시 생성을 시도해 주세요."
}

async function retryChannel(channel: "naver" | "instagram") {
  const completed = await run(() => store.retryChannel(channel))
  if (!completed) return
  const result = channel === "naver" ? store.draft?.naver : store.draft?.instagram
  if (result?.status === "success") showToast(`${channel === "naver" ? "네이버" : "인스타그램"} 글을 다시 생성했어요`)
  else if (result?.error) error.value = result.error
}

async function copyResult(request: { channel: "naver" | "instagram"; part: "title" | "body" | "hashtags" | "all" }) {
  await run(async () => {
    const result = await store.copy(request)
    copyFallback.value = result.fallback
    showToast(result.fallback ? "직접 복사할 글을 열었어요" : "클립보드에 복사했어요")
  })
}

async function rewriteResult(request: { channel: "naver" | "instagram"; section: string; instruction: string }) {
  if (pendingRewriteKey.value) return
  const key = rewriteActionKey(request)
  pendingRewriteKey.value = key
  error.value = null
  try {
    const rewritten = await store.rewrite(request)
    const feedback = rewriteFeedbackFor(request)
    rewritePreviews.value = {
      ...rewritePreviews.value,
      [request.channel]: "title" in rewritten && "body" in rewritten
        ? {
            kind: "title-body",
            section: "titleAndBody",
            label: feedback.preview,
            title: rewritten.title,
            body: rewritten.body,
          }
        : {
            kind: "single",
            section: rewritten.section,
            label: feedback.preview,
            text: rewritten.text,
          }
    }
    showToast(feedback.toast)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "문구를 변경하지 못했어요."
  } finally {
    pendingRewriteKey.value = null
  }
}

async function selectResultOption(request: { channel: "naver" | "instagram"; kind: "title" | "intro" | "hook"; index: number }) {
  const message = request.kind === "title"
    ? "제목 옵션을 변경했어요"
    : request.kind === "intro"
      ? "도입부 옵션을 변경했어요"
      : "첫 문장 옵션을 변경했어요"
  await run(() => store.selectOption(request), message)
}

async function editResult(request: { channel: "naver" | "instagram"; section: "body" | "caption" | "short"; text: string }) {
  await run(() => store.editResult(request), "수정 내용을 저장했어요")
}

async function finalizeResult() {
  const completed = await run(() => store.finalize())
  if (!completed) return
  await router.push({ path: "/", query: { saved: "1" } })
}
</script>

<template>
  <main v-if="store.draft" class="app-page studio-page">
    <header class="studio-header">
      <button type="button" class="icon-button" aria-label="홈으로 돌아가기" @click="router.push('/')">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 5-7 7 7 7" /></svg>
      </button>
      <div>
        <strong>새 콘텐츠 만들기</strong>
        <small role="status" aria-live="polite">
          {{ store.saveStatus === 'error' ? '저장 실패' : store.saveStatus === 'restored' ? '작성 중인 글을 복원했어요' : store.saveStatus === 'saving' ? '저장 중…' : '임시 저장됨' }}
        </small>
      </div>
      <LogoutButton @error="error = $event" />
    </header>

    <ProgressStepper :current="store.draft.step" />
    <ErrorBanner v-if="error" :message="error" @dismiss="error = null" />

    <div class="studio-content">
      <PhotoUploader
        v-if="store.draft.step === 'photos'"
        :images="store.draft.images"
        :busy="store.busy"
        @files-selected="run(() => store.addFiles($event))"
        @retry-image="run(() => store.retryImage($event))"
        @remove-image="run(() => store.removeImage($event))"
      />

      <PhotoOrganizer
        v-else-if="store.draft.step === 'organize'"
        :images="store.draft.images"
        @reorder="store.reorder"
        @set-cover="store.chooseCover"
        @remove-image="run(() => store.removeImage($event))"
      />

      <MemoToneForm
        v-else-if="store.draft.step === 'memo'"
        :memo="store.draft.sourceMemo"
        :must-include="store.draft.mustInclude"
        :avoid="store.draft.avoid"
        :writing-mode="store.draft.writingMode"
        :naver-tone="store.draft.naverTone"
        :instagram-tone="store.draft.instagramTone"
        :busy="store.busy"
        @submit="submitMemo"
      />

      <ContentBriefReview
        v-else-if="store.draft.step === 'brief' && store.draft.brief"
        :brief="store.draft.brief"
        :images="store.draft.images"
        :confirmed="store.draft.briefConfirmed"
        :busy="store.busy"
        @update:brief="store.updateBrief"
        @confirm="store.confirmBrief"
        @generate="generateChannels"
      />

      <GenerationProgress v-else-if="store.draft.step === 'generating'" />

      <ResultEditor
        v-else-if="store.draft.step === 'results' && store.draft.review"
        :naver="store.draft.naver"
        :instagram="store.draft.instagram"
        :review="store.draft.review"
        :copy-fallback="copyFallback"
        :images="store.draft.images"
        :pending-rewrite-key="pendingRewriteKey"
        :rewrite-previews="rewritePreviews"
        @retry-channel="retryChannel"
        @rewrite="rewriteResult"
        @select-option="selectResultOption"
        @edit="editResult"
        @notify="showToast"
        @copy="copyResult"
        @finalize="finalizeResult"
      />

      <section v-else class="empty-row">다음 콘텐츠 단계가 준비되었습니다.</section>
    </div>

    <BottomActionBar v-if="['photos', 'organize'].includes(store.draft.step)">
      <button
        type="button"
        class="primary-action"
        :disabled="store.busy || (store.draft.step === 'photos' && readyImages.length === 0)"
        @click="finishCurrentStep"
      >
        <template v-if="store.busy">사진 준비 중…</template>
        <template v-else-if="store.draft.step === 'photos'">사진 순서 정하기</template>
        <template v-else>메모 작성하기</template>
      </button>
    </BottomActionBar>
    <Transition name="toast">
      <p v-if="toastMessage" :key="toastId" class="action-toast" role="status" aria-live="polite">{{ toastMessage }}</p>
    </Transition>
  </main>
  <main v-else class="app-page"><div class="app-content"><p class="empty-row">작성 중인 글을 불러오는 중입니다.</p></div></main>
</template>
