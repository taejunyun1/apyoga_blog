<script setup lang="ts">
import { ref } from "vue"
import type { ChannelResult, InstagramOutput, NaverOutput, ReviewOutput } from "@/domain/studio"
import ChannelTabs from "./ChannelTabs.vue"
import CopyActionGroup from "./CopyActionGroup.vue"
import PublishChecklist from "./PublishChecklist.vue"
import RewriteActionSheet from "./RewriteActionSheet.vue"

defineProps<{
  naver: ChannelResult<NaverOutput>
  instagram: ChannelResult<InstagramOutput>
  review: ReviewOutput
  copyFallback: string | null
}>()
const emit = defineEmits<{
  "retry-channel": [channel: "naver" | "instagram"]
  rewrite: [request: { channel: "naver" | "instagram"; section: string; instruction: string }]
  copy: [request: { channel: "naver" | "instagram"; part: "title" | "body" | "hashtags" | "all" }]
  "select-option": [request: { channel: "naver" | "instagram"; kind: "title" | "intro" | "hook"; index: number }]
  edit: [request: { channel: "naver" | "instagram"; section: "body" | "caption" | "short"; text: string }]
  notify: [message: string]
  finalize: []
}>()
const active = ref<"naver" | "instagram">("naver")

function selectChannel(channel: "naver" | "instagram") {
  active.value = channel
  emit("notify", channel === "naver" ? "네이버 결과를 열었어요" : "인스타그램 결과를 열었어요")
}

function editText(channel: "naver" | "instagram", section: "body" | "caption" | "short", event: Event) {
  emit("edit", { channel, section, text: (event.currentTarget as HTMLTextAreaElement).value })
}
</script>

<template>
  <section class="result-editor">
    <header class="section-heading-row"><div><h2 class="screen-heading">결과 확인 및 편집</h2><p>생성된 초안입니다. 게시 전에 내용을 직접 확인해 주세요.</p></div></header>
    <ChannelTabs :model-value="active" @update:model-value="selectChannel" />

    <div v-if="active === 'naver'" role="tabpanel" class="channel-panel">
      <template v-if="naver.status === 'success' && naver.data">
        <p class="channel-ready">네이버 글이 준비됐어요</p>
        <p v-if="naver.data.generationSource === 'local-fallback'" class="generation-source-notice" role="status">
          AI 연결이 불안정해 로컬 초안을 사용했어요.
        </p>
        <fieldset class="option-group"><legend>제목 선택</legend><label v-for="(title, index) in naver.data.titles" :key="title"><input type="radio" name="naver-title" :value="index" :checked="index === 0" @change="emit('select-option', { channel: 'naver', kind: 'title', index })" />{{ title }}</label></fieldset>
        <fieldset class="option-group"><legend>도입부 선택</legend><label v-for="(intro, index) in naver.data.introOptions" :key="intro"><input type="radio" name="naver-intro" :value="index" :checked="index === 0" @change="emit('select-option', { channel: 'naver', kind: 'intro', index })" />{{ intro }}</label></fieldset>
        <label class="field-label">본문 편집<textarea :value="naver.data.body" rows="12" @change="editText('naver', 'body', $event)" /></label>
        <ul v-if="naver.data.imagePlacements.length" class="placement-list"><li v-for="placement in naver.data.imagePlacements" :key="placement.imageId">문단 {{ placement.afterParagraph }} 뒤 · {{ placement.caption }}</li></ul>
        <p class="class-info">{{ naver.data.classInfo }}</p>
        <p class="hashtag-line">{{ naver.data.hashtags.join(' ') }}</p>
        <RewriteActionSheet channel="naver" @rewrite="emit('rewrite', $event)" />
        <PublishChecklist :review="review" />
        <CopyActionGroup channel="naver" :fallback="copyFallback" @copy="emit('copy', { channel: 'naver', part: $event })" />
      </template>
      <div v-else-if="naver.status === 'error'" class="channel-error"><p>{{ naver.error }}</p><button type="button" @click="emit('retry-channel', 'naver')">네이버만 다시 생성</button></div>
      <p v-else class="empty-row">네이버 글을 생성하고 있어요.</p>
    </div>

    <div v-else role="tabpanel" class="channel-panel">
      <template v-if="instagram.status === 'success' && instagram.data">
        <p class="channel-ready">인스타그램 글이 준비됐어요</p>
        <p v-if="instagram.data.generationSource === 'local-fallback'" class="generation-source-notice" role="status">
          AI 연결이 불안정해 로컬 초안을 사용했어요.
        </p>
        <fieldset class="option-group"><legend>첫 문장 선택</legend><label v-for="(hook, index) in instagram.data.hookOptions" :key="hook"><input type="radio" name="instagram-hook" :value="index" :checked="index === 0" @change="emit('select-option', { channel: 'instagram', kind: 'hook', index })" />{{ hook }}</label></fieldset>
        <label class="field-label">기본형 캡션<textarea :value="instagram.data.captionLong" rows="9" @change="editText('instagram', 'caption', $event)" /></label>
        <label class="field-label">짧은 캡션<textarea :value="instagram.data.captionShort" rows="3" @change="editText('instagram', 'short', $event)" /></label>
        <p class="hashtag-line">{{ instagram.data.hashtags.join(' ') }}</p>
        <RewriteActionSheet channel="instagram" @rewrite="emit('rewrite', $event)" />
        <PublishChecklist :review="review" />
        <CopyActionGroup channel="instagram" :fallback="copyFallback" @copy="emit('copy', { channel: 'instagram', part: $event })" />
      </template>
      <div v-else-if="instagram.status === 'error'" class="channel-error"><p>{{ instagram.error }}</p><button type="button" @click="emit('retry-channel', 'instagram')">인스타그램만 다시 생성</button></div>
      <p v-else class="empty-row">인스타그램 글을 생성하고 있어요.</p>
    </div>

    <button class="secondary-action" type="button" @click="emit('finalize')">작성 이력에 저장</button>
  </section>
</template>
