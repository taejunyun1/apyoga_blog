<script setup lang="ts">
defineProps<{ message: string }>()
defineEmits<{ dismiss: [] }>()
</script>
<template>
  <div class="error-banner" role="alert">
    <span>{{ message }}</span>
    <button type="button" aria-label="오류 닫기" @click="$emit('dismiss')">닫기</button>
  </div>
</template>
