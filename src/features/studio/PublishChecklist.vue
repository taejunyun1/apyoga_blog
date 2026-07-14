<script setup lang="ts">import type { ReviewOutput } from "@/domain/studio"; defineProps<{ review: ReviewOutput }>()</script>
<template>
  <section class="publish-checklist" aria-labelledby="checklist-heading">
    <h3 id="checklist-heading">게시 전 확인</h3>
    <ul>
      <li :class="{ warning: review.medicalClaims.length }">{{ review.medicalClaims.length ? '!' : '✓' }} 의학적 단정 표현 없음</li>
      <li :class="{ warning: review.repetitions.length }">{{ review.repetitions.length ? '!' : '✓' }} 반복 표현 적음</li>
      <li class="warning">! 예약 정보는 운영 연동 전 확인 필요</li>
      <li>✓ 사진 순서 확인</li>
    </ul>
  </section>
</template>
