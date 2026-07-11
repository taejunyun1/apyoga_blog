<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import BottomActionBar from "@/features/studio/BottomActionBar.vue"
import ContentBriefReview from "@/features/studio/ContentBriefReview.vue"
import ErrorBanner from "@/features/studio/ErrorBanner.vue"
import FaceMaskEditor from "@/features/studio/FaceMaskEditor.vue"
import GenerationProgress from "@/features/studio/GenerationProgress.vue"
import MemoToneForm from "@/features/studio/MemoToneForm.vue"
import PhotoOrganizer from "@/features/studio/PhotoOrganizer.vue"
import PhotoUploader from "@/features/studio/PhotoUploader.vue"
import ProgressStepper from "@/features/studio/ProgressStepper.vue"
import ResultEditor from "@/features/studio/ResultEditor.vue"
import { useAutosave } from "@/features/studio/composables/use-autosave"
import { useStudioStore } from "@/features/studio/studio-store"
import type { FaceMask } from "@/domain/studio"

const route = useRoute()
const router = useRouter()
const store = useStudioStore()
const error = ref<string | null>(null)
const activeMaskIndex = ref(0)
const copyFallback = ref<string | null>(null)
const copyStatus = ref<string | null>(null)
const stopAutosave = useAutosave(store)

const readyImages = computed(() => store.draft?.images.filter((image) => image.status === "ready") ?? [])
const activeMaskImage = computed(() => readyImages.value[activeMaskIndex.value] ?? null)

onMounted(async () => {
  const draftId = String(route.params.draftId)
  if (!store.draft || store.draft.id !== draftId) {
    try { await store.load(draftId) }
    catch (reason) { error.value = reason instanceof Error ? reason.message : "글을 불러오지 못했어요." }
  }
})

onUnmounted(stopAutosave)

async function run(action: () => Promise<unknown>) {
  error.value = null
  try { await action() }
  catch (reason) { error.value = reason instanceof Error ? reason.message : "요청을 처리하지 못했어요." }
}

function updateMasks(masks: FaceMask[]) {
  if (activeMaskImage.value) store.updateMasks(activeMaskImage.value.id, masks)
}

async function finishCurrentStep() {
  if (!store.draft) return
  if (store.draft.step === "photos") {
    await run(() => store.beginMasking())
  } else if (store.draft.step === "mask") {
    if (activeMaskIndex.value < readyImages.value.length - 1) activeMaskIndex.value += 1
    else await run(() => store.confirmMasks())
  } else if (store.draft.step === "organize") {
    store.draft.step = "memo"
    await run(() => store.saveNow())
  }
}

async function submitMemo(value: Parameters<typeof store.updateMemo>[0]) {
  store.updateMemo(value)
  await run(() => store.analyze())
}

async function generateChannels() {
  await run(() => store.generateAll())
}

async function retryChannel(channel: "naver" | "instagram") {
  await run(() => store.retryChannel(channel))
}

async function copyResult(request: { channel: "naver" | "instagram"; part: "title" | "body" | "hashtags" | "all" }) {
  await run(async () => {
    const result = await store.copy(request)
    copyFallback.value = result.fallback
    copyStatus.value = result.fallback ? "직접 복사할 글을 열었어요" : "클립보드에 복사했어요"
  })
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
      <img src="/app-icon.svg" alt="" />
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

      <section v-else-if="store.draft.step === 'mask'" class="mask-step">
        <p v-if="store.faceDetectionMessage" class="info-banner" role="status">{{ store.faceDetectionMessage }}</p>
        <FaceMaskEditor v-if="activeMaskImage" :key="activeMaskImage.id" :image="activeMaskImage" @update-masks="updateMasks" />
        <p v-else class="empty-row">가림을 편집할 사진이 없습니다.</p>
      </section>

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
        @submit="submitMemo"
      />

      <ContentBriefReview
        v-else-if="store.draft.step === 'brief' && store.draft.brief"
        :brief="store.draft.brief"
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
        :copy-status="copyStatus"
        @retry-channel="retryChannel"
        @rewrite="run(() => store.rewrite($event))"
        @select-option="run(() => store.selectOption($event))"
        @copy="copyResult"
        @finalize="run(() => store.finalize())"
      />

      <section v-else class="empty-row">다음 콘텐츠 단계가 준비되었습니다.</section>
    </div>

    <BottomActionBar v-if="['photos', 'mask', 'organize'].includes(store.draft.step)">
      <button
        type="button"
        class="primary-action"
        :disabled="store.busy || (store.draft.step === 'photos' && readyImages.length === 0)"
        @click="finishCurrentStep"
      >
        <template v-if="store.busy">얼굴 찾는 중…</template>
        <template v-else-if="store.draft.step === 'photos'">얼굴 가림 확인</template>
        <template v-else-if="store.draft.step === 'mask' && activeMaskIndex < readyImages.length - 1">다음 사진</template>
        <template v-else-if="store.draft.step === 'mask'">가림 확인 완료</template>
        <template v-else>메모 작성하기</template>
      </button>
    </BottomActionBar>
  </main>
  <main v-else class="app-page"><div class="app-content"><p class="empty-row">작성 중인 글을 불러오는 중입니다.</p></div></main>
</template>
