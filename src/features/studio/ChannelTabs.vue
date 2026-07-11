<script setup lang="ts">
defineProps<{ modelValue: "naver" | "instagram" }>()
defineEmits<{ "update:modelValue": [value: "naver" | "instagram"] }>()
</script>
<template>
  <div class="channel-tabs" role="tablist" aria-label="콘텐츠 채널">
    <button type="button" role="tab" :aria-selected="modelValue === 'naver'" @click="$emit('update:modelValue', 'naver')">네이버 블로그</button>
    <button type="button" role="tab" :aria-selected="modelValue === 'instagram'" @click="$emit('update:modelValue', 'instagram')">인스타그램</button>
  </div>
</template>
