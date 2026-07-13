<script setup lang="ts">
import { computed } from "vue"

const props = defineProps<{
  channel: "naver" | "instagram"
  pendingKey: string | null
}>()
defineEmits<{ rewrite: [request: { channel: "naver" | "instagram"; section: string; instruction: string }] }>()

const actions = computed(() => props.channel === "naver"
  ? [
      { section: "intro", instruction: "감성 줄이기", label: "감성 줄이기", accessibleLabel: "도입부 감성 줄이기" },
      { section: "body", instruction: "철학 줄이기", label: "철학 줄이기" },
      { section: "body", instruction: "사진 설명 늘리기", label: "사진 설명 늘리기" },
      { section: "title", instruction: "최근 글과 다르게", label: "최근 글과 다르게" }
    ]
  : [
      { section: "hook", instruction: "첫 문장만 변경", label: "첫 문장 변경" },
      { section: "short", instruction: "더 짧게", label: "더 짧게" },
      { section: "hashtags", instruction: "해시태그 변경", label: "해시태그 변경" }
    ])

function keyFor(section: string, instruction: string) {
  return `${props.channel}:${section}:${instruction}`
}
</script>
<template>
  <section class="rewrite-actions" aria-label="부분 다시 쓰기">
    <button
      v-for="action in actions"
      :key="keyFor(action.section, action.instruction)"
      type="button"
      :disabled="pendingKey !== null"
      :aria-busy="pendingKey === keyFor(action.section, action.instruction)"
      :aria-label="action.accessibleLabel ? `${action.accessibleLabel}${pendingKey === keyFor(action.section, action.instruction) ? ' 변경 중…' : ''}` : undefined"
      @click="$emit('rewrite', { channel, section: action.section, instruction: action.instruction })"
    >
      {{ action.label }}{{ pendingKey === keyFor(action.section, action.instruction) ? ' 변경 중…' : '' }}
    </button>
  </section>
</template>
