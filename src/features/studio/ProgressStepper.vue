<script setup lang="ts">
import type { WorkflowStep } from "@/domain/studio"

const props = defineProps<{ current: WorkflowStep }>()
const steps: Array<{ id: WorkflowStep; label: string }> = [
  { id: "photos", label: "사진" },
  { id: "mask", label: "가림" },
  { id: "organize", label: "순서" },
  { id: "memo", label: "메모" },
  { id: "brief", label: "확인" },
  { id: "generating", label: "생성" },
  { id: "results", label: "결과" }
]

function state(index: number) {
  const currentIndex = steps.findIndex((step) => step.id === props.current)
  return index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming"
}
</script>

<template>
  <ol class="progress-stepper" aria-label="콘텐츠 제작 단계">
    <li v-for="(step, index) in steps" :key="step.id" :class="`is-${state(index)}`" :aria-current="state(index) === 'current' ? 'step' : undefined">
      <span>{{ index + 1 }}</span><small>{{ step.label }}</small>
    </li>
  </ol>
</template>
