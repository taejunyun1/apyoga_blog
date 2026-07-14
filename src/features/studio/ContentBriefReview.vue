<script setup lang="ts">
import { computed, ref, watch } from "vue"
import type { ContentBrief, StudioImage } from "@/domain/studio"

const props = defineProps<{ brief: ContentBrief; images: StudioImage[]; confirmed: boolean; busy: boolean }>()
const emit = defineEmits<{ "update:brief": [brief: ContentBrief]; confirm: []; generate: [] }>()
const local = ref<ContentBrief>(clone(props.brief))
const locallyConfirmed = ref(props.confirmed)
const newFocus = ref("")
const analyzedImages = computed(() => props.brief.imageDescriptions.map((analysis, index) => ({
  ...analysis,
  image: props.images.find((image) => image.id === analysis.imageId),
  index
})))

watch(() => props.brief, (value) => { local.value = clone(value) }, { deep: true })
watch(() => props.confirmed, (value) => { locallyConfirmed.value = value })

function update(mutator: (brief: ContentBrief) => void) {
  const next = clone(local.value)
  mutator(next)
  local.value = next
  locallyConfirmed.value = false
  emit("update:brief", clone(next))
}

function addFocus() {
  const value = newFocus.value.trim()
  if (!value || local.value.bodyFocus.includes(value)) return
  update((brief) => brief.bodyFocus.push(value))
  newFocus.value = ""
}

function confirm() {
  locallyConfirmed.value = true
  emit("confirm")
}

function clone(value: ContentBrief): ContentBrief {
  return JSON.parse(JSON.stringify(value)) as ContentBrief
}
</script>

<template>
  <section class="brief-review" aria-labelledby="brief-heading">
    <header class="section-heading-row"><div><h2 id="brief-heading" class="screen-heading">AI가 이해한 오늘의 수련</h2><p>두 채널 글을 만들기 전에 핵심 내용을 확인해 주세요.</p></div></header>
    <label class="field-label">수련 요약<textarea v-model="local.classSummary" rows="3" @change="update((brief) => brief.classSummary = local.classSummary)" /></label>
    <label class="field-label">전체 분위기<input v-model="local.overallMood" type="text" @change="update((brief) => brief.overallMood = local.overallMood)" /></label>
    <div class="field-label"><span>신체 초점</span><div class="chip-list"><button v-for="focus in local.bodyFocus" :key="focus" type="button" :aria-label="`${focus} 삭제`" @click="update((brief) => brief.bodyFocus = brief.bodyFocus.filter((item) => item !== focus))">{{ focus }} ×</button></div></div>
    <form class="inline-add" @submit.prevent="addFocus"><label class="visually-hidden" for="new-focus">신체 초점 추가</label><input id="new-focus" v-model="newFocus" type="text" placeholder="항목 추가" /><button type="submit">추가</button></form>
    <div class="field-label"><span>시각 키워드</span><div class="chip-list"><button v-for="keyword in local.visualKeywords" :key="keyword" type="button" :aria-label="`${keyword} 삭제`" @click="update((brief) => brief.visualKeywords = brief.visualKeywords.filter((item) => item !== keyword))">{{ keyword }} ×</button></div></div>
    <section v-if="analyzedImages.length" class="photo-analysis" aria-labelledby="photo-analysis-heading">
      <h3 id="photo-analysis-heading">사진에서 확인한 내용</h3>
      <p>사진과 설명이 맞는지 확인해 주세요. 이 내용을 바탕으로 글을 작성합니다.</p>
      <ol class="photo-analysis__list">
        <li v-for="entry in analyzedImages" :key="entry.imageId">
          <img v-if="entry.image" :src="entry.image.thumbnailUrl" :alt="`${entry.index + 1}번째 사진 ${entry.image.name}`" />
          <div v-else class="photo-analysis__missing">사진 없음</div>
          <div>
            <strong>{{ entry.index + 1 }}번째 사진</strong>
            <p>{{ entry.description }}</p>
          </div>
        </li>
      </ol>
    </section>
    <p class="season-note">{{ local.seasonalContext }}</p>
    <button v-if="!locallyConfirmed" class="secondary-action" type="button" @click="confirm">이해한 내용이 맞아요</button>
    <p v-else class="confirmation-note">✓ 이해 내용 확인 완료</p>
    <button class="primary-action" type="button" :disabled="!locallyConfirmed || busy" @click="emit('generate')">{{ busy ? '두 채널 생성 중…' : '두 채널 글 생성' }}</button>
  </section>
</template>
