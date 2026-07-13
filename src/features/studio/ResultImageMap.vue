<script setup lang="ts">
import { computed } from "vue"
import type { NaverOutput, StudioImage } from "@/domain/studio"

const props = defineProps<{
  channel: "naver" | "instagram"
  images: StudioImage[]
  placements: NaverOutput["imagePlacements"]
  imageOrder: string[]
  coverImageId: string
}>()

const headingId = computed(() => `result-image-map-${props.channel}-heading`)
const heading = computed(() => props.channel === "naver" ? "사진과 글 배치" : "사진 게시 순서")
const imageById = computed(() => new Map(props.images.map((image) => [image.id, image])))
const entries = computed(() => {
  if (props.channel === "naver") {
    return props.placements
      .toSorted((a, b) => a.afterParagraph - b.afterParagraph)
      .map((placement) => ({
        imageId: placement.imageId,
        image: imageById.value.get(placement.imageId),
        position: `문단 ${placement.afterParagraph} 뒤`,
        caption: placement.caption,
        alt: placement.caption,
        isCover: false
      }))
  }

  return props.imageOrder.map((imageId, index) => {
    const image = imageById.value.get(imageId)
    return {
      imageId,
      image,
      position: `${index + 1}번째`,
      caption: "",
      alt: image ? `${index + 1}번째 사진 ${image.name}` : "",
      isCover: imageId === props.coverImageId
    }
  })
})
</script>

<template>
  <section class="result-image-map" :aria-labelledby="headingId">
    <h3 :id="headingId">{{ heading }}</h3>
    <ol class="result-image-map__list">
      <li v-for="entry in entries" :key="entry.imageId" class="result-image-card">
        <img v-if="entry.image" :src="entry.image.thumbnailUrl" :alt="entry.alt" loading="lazy" />
        <div v-else class="result-image-card__missing">사진을 불러올 수 없어요</div>
        <p class="result-image-card__position">{{ entry.position }}</p>
        <p v-if="entry.caption" class="result-image-card__caption">{{ entry.caption }}</p>
        <span v-if="entry.isCover" class="result-image-card__cover">대표 사진</span>
      </li>
    </ol>
  </section>
</template>
