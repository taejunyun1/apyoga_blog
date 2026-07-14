<script setup lang="ts">
import type { StudioImage } from "@/domain/studio"
defineProps<{ images: StudioImage[]; busy: boolean }>()
const emit = defineEmits<{
  "files-selected": [files: File[]]
  "retry-image": [imageId: string]
  "remove-image": [imageId: string]
}>()

function selectFiles(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (files.length > 0) emit("files-selected", files)
  input.value = ""
}
</script>
<template>
  <section class="photo-uploader" aria-labelledby="photo-upload-heading">
    <div class="section-heading-row">
      <div>
        <h2 id="photo-upload-heading" class="screen-heading">수련 사진을 선택해 주세요</h2>
        <p>원본은 저장하지 않으며, 메타데이터를 제거한 축소 사진만 AI 분석에 사용해요.</p>
      </div>
      <span>{{ images.length }} / 최대 10장</span>
    </div>

    <label class="upload-dropzone" :class="{ 'is-busy': busy }" for="studio-photo-input">
      <strong>{{ busy ? '사진을 안전하게 준비하는 중…' : '사진 추가' }}</strong>
      <span>JPEG · PNG · WebP · HEIC</span>
    </label>
    <input
      id="studio-photo-input"
      class="visually-hidden"
      aria-label="수련 사진 선택"
      type="file"
      accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
      multiple
      :disabled="busy || images.length >= 10"
      @change="selectFiles"
    />

    <ul v-if="images.length" class="photo-status-list">
      <li v-for="image in images" :key="image.id">
        <img v-if="image.thumbnailUrl" :src="image.thumbnailUrl" alt="" />
        <div>
          <strong>{{ image.name }}</strong>
          <span v-if="image.status === 'ready'" class="status-success">처리 완료</span>
          <span v-else-if="image.status === 'processing'">변환·압축 중</span>
          <span v-else class="status-error">{{ image.error }}</span>
        </div>
        <button v-if="image.status === 'error'" type="button" :aria-label="`${image.name} 다시 처리`" @click="emit('retry-image', image.id)">재시도</button>
        <button v-else type="button" class="icon-button" :aria-label="`${image.name} 삭제`" @click="emit('remove-image', image.id)">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" /></svg>
        </button>
      </li>
    </ul>
  </section>
</template>
