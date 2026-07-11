<script setup lang="ts">
import type { MaskStyle } from "@/domain/studio"
defineProps<{ selected: MaskStyle; disabled: boolean }>()
defineEmits<{ select: [style: MaskStyle]; "apply-all": [] }>()
</script>

<template>
  <fieldset class="mask-style-fieldset">
    <legend>가림 방식</legend>
    <div class="mask-style-grid">
      <button type="button" :aria-pressed="selected === 'blur'" @click="$emit('select', 'blur')"><span class="mask-preview is-blur" />부드러운 블러</button>
      <button type="button" :aria-pressed="selected === 'white'" @click="$emit('select', 'white')"><span class="mask-preview is-white" />흰색 원</button>
      <button type="button" :aria-pressed="selected === 'sticker'" @click="$emit('select', 'sticker')"><img src="/app-icon.svg" alt="" />A.P YOGA 스티커</button>
    </div>
    <button type="button" class="secondary-action" :disabled="disabled" @click="$emit('apply-all')">모든 얼굴에 적용</button>
  </fieldset>
</template>
