<script setup lang="ts">
import { ref } from "vue"
import type { Tone, WritingMode } from "@/domain/studio"

const props = withDefaults(defineProps<{ memo: string; mustInclude: string; avoid: string; writingMode: WritingMode; naverTone: Tone; instagramTone: Tone; busy?: boolean }>(), {
  busy: false,
})
const emit = defineEmits<{ submit: [value: { memo: string; mustInclude: string; avoid: string; writingMode: WritingMode; naverTone: Tone; instagramTone: Tone }] }>()
const memo = ref(props.memo)
const mustInclude = ref(props.mustInclude)
const avoid = ref(props.avoid)
const writingMode = ref(props.writingMode)
const naverTone = ref(props.naverTone)
const instagramTone = ref(props.instagramTone)

const modes: Array<{ value: WritingMode; label: string }> = [
  { value: "auto", label: "자동 추천" }, { value: "record", label: "기록형" },
  { value: "essay", label: "에세이형" }, { value: "philosophy", label: "철학형" },
  { value: "body-sense", label: "신체 감각형" }, { value: "space", label: "공간·분위기형" },
  { value: "daily", label: "가벼운 일상형" }
]
const tones: Array<{ value: Tone; label: string }> = [
  { value: "plain", label: "담백하게" }, { value: "emotional", label: "조금 감성적으로" }, { value: "deep", label: "깊이 있게" }
]

function submit() {
  if (props.busy) return
  emit("submit", { memo: memo.value.trim(), mustInclude: mustInclude.value.trim(), avoid: avoid.value.trim(), writingMode: writingMode.value, naverTone: naverTone.value, instagramTone: instagramTone.value })
}
</script>

<template>
  <form class="memo-form" @submit.prevent="submit">
    <header class="section-heading-row"><div><h2 class="screen-heading">짧은 수련 메모</h2><p>오늘 기억하고 싶은 장면이나 감각을 한두 문장으로 적어주세요.</p></div></header>
    <label class="field-label">오늘의 수련 메모<textarea v-model="memo" rows="5" maxlength="600" placeholder="예: 어깨와 흉곽을 천천히 열어간 차분한 저녁 수련" /></label>
    <div class="two-column-fields">
      <label class="field-label">꼭 포함할 내용<input v-model="mustInclude" type="text" placeholder="예: 호흡" /></label>
      <label class="field-label">피할 내용<input v-model="avoid" type="text" placeholder="예: 치료, 완치" /></label>
    </div>
    <label class="field-label">글쓰기 방식<select v-model="writingMode"><option v-for="mode in modes" :key="mode.value" :value="mode.value">{{ mode.label }}</option></select></label>
    <div class="two-column-fields">
      <label class="field-label">네이버 톤<select v-model="naverTone"><option v-for="tone in tones" :key="tone.value" :value="tone.value">{{ tone.label }}</option></select></label>
      <label class="field-label">인스타그램 톤<select v-model="instagramTone"><option v-for="tone in tones" :key="tone.value" :value="tone.value">{{ tone.label }}</option></select></label>
    </div>
    <button class="primary-action" type="submit" :disabled="busy || memo.trim().length === 0">
      {{ busy ? '사진과 메모 분석 중…' : 'AI 이해 내용 만들기' }}
    </button>
  </form>
</template>
