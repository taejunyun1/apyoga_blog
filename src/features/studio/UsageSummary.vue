<script setup lang="ts">
import { computed } from "vue"
import type { DraftUsage } from "@/domain/studio"

const props = defineProps<{
  usage: DraftUsage
  scope: "draft" | "project"
}>()

const title = computed(() => props.scope === "draft" ? "이번 글 AI 사용량" : "프로젝트 AI 사용량")
const formatNumber = new Intl.NumberFormat("ko-KR")

function format(value: number) {
  return formatNumber.format(value)
}
</script>

<template>
  <section class="usage-summary" :aria-labelledby="`${scope}-usage-heading`">
    <div class="usage-summary__header">
      <h2 :id="`${scope}-usage-heading`">{{ title }}</h2>
      <p>총 {{ format(usage.totalTokens) }} 토큰</p>
    </div>
    <ul class="usage-summary__breakdown" aria-label="토큰 사용 내역">
      <li>입력 {{ format(usage.inputTokens) }} 토큰</li>
      <li>캐시 입력 {{ format(usage.cachedInputTokens) }} 토큰</li>
      <li>출력 {{ format(usage.outputTokens) }} 토큰</li>
      <li>요청 {{ format(usage.requestCount) }}회</li>
    </ul>
    <p class="usage-summary__cost">추정 비용 {{ format(usage.estimatedKrw) }}원</p>
  </section>
</template>
