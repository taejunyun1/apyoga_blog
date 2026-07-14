<script setup lang="ts">
import type { WorkflowStep } from "@/domain/studio"

const props = defineProps<{ current: WorkflowStep }>()
const emit = defineEmits<{ navigate: [step: WorkflowStep] }>()
const steps: Array<{ id: WorkflowStep; label: string }> = [
  { id: "photos", label: "사진" },
  { id: "organize", label: "순서" },
  { id: "memo", label: "메모" },
  { id: "brief", label: "확인" },
  { id: "generating", label: "생성" },
  { id: "results", label: "결과" }
]
const stableSteps = new Set<WorkflowStep>(["photos", "organize", "memo", "brief", "results"])

function state(index: number) {
  const currentIndex = steps.findIndex((step) => step.id === props.current)
  return index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming"
}

function canNavigate(step: WorkflowStep, index: number) {
  return state(index) === "complete" && stableSteps.has(step)
}
</script>

<template>
  <ol class="progress-stepper" aria-label="콘텐츠 제작 단계">
    <li v-for="(step, index) in steps" :key="step.id" :class="`is-${state(index)}`" :aria-current="state(index) === 'current' ? 'step' : undefined">
      <button
        v-if="canNavigate(step.id, index)"
        type="button"
        class="progress-stepper__control"
        :aria-label="`${index + 1}단계 ${step.label}로 이동`"
        @click="emit('navigate', step.id)"
      >
        <span class="progress-stepper__indicator">{{ index + 1 }}</span><small class="progress-stepper__label">{{ step.label }}</small>
      </button>
      <span v-else class="progress-stepper__control progress-stepper__control--static">
        <span class="progress-stepper__indicator">{{ index + 1 }}</span><small class="progress-stepper__label">{{ step.label }}</small>
      </span>
    </li>
  </ol>
</template>
