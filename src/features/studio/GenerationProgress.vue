<script setup lang="ts">defineProps<{ current?: number }>()</script>
<template>
  <section class="generation-progress" aria-live="polite">
    <img src="/app-icon.svg" alt="" />
    <h2 class="screen-heading">두 채널 글을 만들고 있어요</h2>
    <ol>
      <li v-for="(label, index) in ['사진 분석 중', '수련 내용 정리 중', '네이버 글 작성 중', '인스타그램 글 작성 중', 'A.P YOGA 문체 검수 중']" :key="label" :class="{ active: index <= (current ?? 4) }">{{ index <= (current ?? 4) ? '✓' : '○' }} {{ label }}</li>
    </ol>
  </section>
</template>
