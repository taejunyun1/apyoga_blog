<script setup lang="ts">
defineProps<{ channel: "naver" | "instagram" }>()
defineEmits<{ rewrite: [request: { channel: "naver" | "instagram"; section: string; instruction: string }] }>()
</script>
<template>
  <section class="rewrite-actions" aria-label="부분 다시 쓰기">
    <template v-if="channel === 'naver'">
      <button type="button" aria-label="도입부 감성 줄이기" @click="$emit('rewrite', { channel, section: 'intro', instruction: '감성 줄이기' })">감성 줄이기</button>
      <button type="button" @click="$emit('rewrite', { channel, section: 'body', instruction: '철학 줄이기' })">철학 줄이기</button>
      <button type="button" @click="$emit('rewrite', { channel, section: 'body', instruction: '사진 설명 늘리기' })">사진 설명 늘리기</button>
      <button type="button" @click="$emit('rewrite', { channel, section: 'title', instruction: '최근 글과 다르게' })">최근 글과 다르게</button>
    </template>
    <template v-else>
      <button type="button" @click="$emit('rewrite', { channel, section: 'hook', instruction: '첫 문장만 변경' })">첫 문장 변경</button>
      <button type="button" @click="$emit('rewrite', { channel, section: 'short', instruction: '더 짧게' })">더 짧게</button>
      <button type="button" @click="$emit('rewrite', { channel, section: 'hashtags', instruction: '해시태그 변경' })">해시태그 변경</button>
    </template>
  </section>
</template>
