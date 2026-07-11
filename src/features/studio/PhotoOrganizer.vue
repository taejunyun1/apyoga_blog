<script setup lang="ts">
import type { StudioImage } from "@/domain/studio"
defineProps<{ images: StudioImage[] }>()
const emit = defineEmits<{
  reorder: [from: number, to: number]
  "set-cover": [imageId: string]
  "remove-image": [imageId: string]
}>()

function expiry(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(new Date(value))
}
</script>
<template>
  <section aria-labelledby="organize-heading">
    <header class="section-heading-row">
      <div>
        <h2 id="organize-heading" class="screen-heading">사진 순서와 대표 사진</h2>
        <p>추천은 자동 확정되지 않아요. 원하는 순서로 직접 확인해 주세요.</p>
      </div>
    </header>

    <ol class="organizer-list">
      <li v-for="(image, index) in images" :key="image.id">
        <span class="order-number">{{ index + 1 }}</span>
        <img :src="image.thumbnailUrl" alt="" />
        <div class="organizer-list__body">
          <strong>{{ image.name }}</strong>
          <span>얼굴 {{ image.faceCount }}개 · 가림 {{ image.masks.length }}개</span>
          <small>{{ expiry(image.expiresAt) }} 자동 삭제</small>
        </div>
        <div class="organizer-actions">
          <button type="button" :disabled="index === 0" :aria-label="`${image.name} 앞으로 이동`" @click="emit('reorder', index, index - 1)">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 5-6 6m6-6 6 6M12 5v14" /></svg>
          </button>
          <button type="button" :disabled="index === images.length - 1" :aria-label="`${image.name} 뒤로 이동`" @click="emit('reorder', index, index + 1)">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 19-6-6m6 6 6-6M12 19V5" /></svg>
          </button>
          <button type="button" :aria-pressed="image.isCover" :aria-label="`${image.name} 대표 사진으로 선택`" @click="emit('set-cover', image.id)">
            {{ image.isCover ? '대표' : '대표 선택' }}
          </button>
          <button type="button" :aria-label="`${image.name} 삭제`" @click="emit('remove-image', image.id)">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13" /></svg>
          </button>
        </div>
      </li>
    </ol>
  </section>
</template>
