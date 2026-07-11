<script setup lang="ts">
defineProps<{ channel: "naver" | "instagram"; fallback: string | null }>()
defineEmits<{ copy: [part: "title" | "body" | "hashtags" | "all"] }>()
</script>
<template>
  <section class="copy-actions" aria-label="채널별 복사">
    <button type="button" @click="$emit('copy', 'title')">{{ channel === 'naver' ? '제목 복사' : '첫 문장 복사' }}</button>
    <button type="button" @click="$emit('copy', 'body')">{{ channel === 'naver' ? '본문 복사' : '캡션 복사' }}</button>
    <button type="button" @click="$emit('copy', 'hashtags')">해시태그 복사</button>
    <button type="button" class="primary-copy" @click="$emit('copy', 'all')">전체 복사</button>
    <div v-if="fallback" class="copy-fallback" role="alert">
      <strong>길게 눌러 복사해 주세요</strong>
      <textarea aria-label="직접 복사할 글" readonly :value="fallback" @focus="($event.target as HTMLTextAreaElement).select()" />
    </div>
  </section>
</template>
