<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue"
import { useResizeObserver } from "@vueuse/core"
import type { FaceMask, MaskStyle, StudioImage } from "@/domain/studio"
import MaskStylePicker from "./MaskStylePicker.vue"

const props = defineProps<{ image: StudioImage }>()
const emit = defineEmits<{ "update-masks": [masks: FaceMask[]] }>()
const container = ref<HTMLElement | null>(null)
const stageRef = ref<{ getNode?: () => { findOne(selector: string): unknown } } | null>(null)
const transformerRef = ref<{ getNode?: () => { nodes(value: unknown[]): void; getLayer(): { batchDraw(): void } | null } } | null>(null)
const stageWidth = ref(360)
const canvasImage = ref<HTMLImageElement | null>(null)
const masks = ref<FaceMask[]>(cloneMasks(props.image.masks))
const selectedId = ref<string | null>(masks.value[0]?.id ?? null)
const selectedStyle = ref<MaskStyle>(masks.value[0]?.style ?? "blur")
const history = ref<FaceMask[][]>([])
const lastPinchDistance = ref<number | null>(null)

const stageHeight = computed(() => Math.round(stageWidth.value * props.image.height / props.image.width))
const selectedMask = computed(() => masks.value.find((mask) => mask.id === selectedId.value) ?? null)

watch(() => props.image.id, () => {
  masks.value = cloneMasks(props.image.masks)
  selectedId.value = masks.value[0]?.id ?? null
})

watch(selectedId, () => nextTick(attachTransformer))

onMounted(() => {
  const image = new Image()
  image.onload = () => { canvasImage.value = image }
  image.src = props.image.thumbnailUrl
})

useResizeObserver(container, (entries) => {
  stageWidth.value = Math.max(280, Math.min(720, Math.floor(entries[0].contentRect.width || 360)))
})

function snapshot() {
  history.value.push(cloneMasks(masks.value))
  if (history.value.length > 20) history.value.shift()
}

function publish() {
  emit("update-masks", cloneMasks(masks.value))
}

function selectMask(id: string) {
  selectedId.value = id
  nextTick(attachTransformer)
}

function attachTransformer() {
  const stage = stageRef.value?.getNode?.()
  const transformer = transformerRef.value?.getNode?.()
  if (!stage || !transformer || !selectedId.value) return
  const node = stage.findOne(`#${selectedId.value}`)
  transformer.nodes(node ? [node] : [])
  transformer.getLayer()?.batchDraw()
}

function addMask() {
  snapshot()
  const mask: FaceMask = {
    id: crypto.randomUUID(), style: selectedStyle.value, x: 0.35, y: 0.3,
    width: 0.3, height: 0.3, rotation: 0, source: "manual"
  }
  masks.value.push(mask)
  selectedId.value = mask.id
  publish()
}

function deleteMask() {
  const id = selectedId.value ?? masks.value.at(-1)?.id
  if (!id) return
  snapshot()
  masks.value = masks.value.filter((mask) => mask.id !== id)
  selectedId.value = masks.value.at(-1)?.id ?? null
  publish()
}

function undo() {
  const previous = history.value.pop()
  if (!previous) return
  masks.value = previous
  selectedId.value = masks.value.at(-1)?.id ?? null
  publish()
}

function chooseStyle(style: MaskStyle) {
  selectedStyle.value = style
  const mask = selectedMask.value
  if (!mask) return
  snapshot()
  mask.style = style
  publish()
}

function applyStyleToAll() {
  snapshot()
  masks.value = masks.value.map((mask) => ({ ...mask, style: selectedStyle.value }))
  publish()
}

function updateSelected(key: "width" | "rotation", value: number) {
  const mask = selectedMask.value
  if (!mask) return
  snapshot()
  if (key === "width") {
    mask.width = value
    mask.height = value
  } else mask.rotation = value
  publish()
}

function groupConfig(mask: FaceMask) {
  return {
    id: mask.id,
    x: mask.x * stageWidth.value,
    y: mask.y * stageHeight.value,
    width: mask.width * stageWidth.value,
    height: mask.height * stageHeight.value,
    rotation: mask.rotation,
    draggable: true
  }
}

function dragEnd(mask: FaceMask, event: { target: { x(): number; y(): number } }) {
  snapshot()
  mask.x = Math.max(0, Math.min(1 - mask.width, event.target.x() / stageWidth.value))
  mask.y = Math.max(0, Math.min(1 - mask.height, event.target.y() / stageHeight.value))
  publish()
}

function transformEnd(mask: FaceMask, event: { target: { x(): number; y(): number; width(): number; height(): number; scaleX(): number; scaleY(): number; rotation(): number; scale(value: { x: number; y: number }): void } }) {
  snapshot()
  const node = event.target
  mask.x = Math.max(0, node.x() / stageWidth.value)
  mask.y = Math.max(0, node.y() / stageHeight.value)
  mask.width = Math.min(1 - mask.x, node.width() * node.scaleX() / stageWidth.value)
  mask.height = Math.min(1 - mask.y, node.height() * node.scaleY() / stageHeight.value)
  mask.rotation = node.rotation()
  node.scale({ x: 1, y: 1 })
  publish()
  nextTick()
}

function pinchMove(event: { evt?: TouchEvent }) {
  const touches = event.evt?.touches
  const mask = selectedMask.value
  if (!touches || touches.length !== 2 || !mask) return
  const distance = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
  if (lastPinchDistance.value === null) {
    snapshot()
    lastPinchDistance.value = distance
    return
  }
  const scale = distance / lastPinchDistance.value
  const centerX = mask.x + mask.width / 2
  const centerY = mask.y + mask.height / 2
  const nextWidth = Math.max(0.1, Math.min(0.8, mask.width * scale))
  const nextHeight = Math.max(0.1, Math.min(0.8, mask.height * scale))
  mask.width = nextWidth
  mask.height = nextHeight
  mask.x = Math.max(0, Math.min(1 - nextWidth, centerX - nextWidth / 2))
  mask.y = Math.max(0, Math.min(1 - nextHeight, centerY - nextHeight / 2))
  lastPinchDistance.value = distance
  publish()
}

function pinchEnd() {
  lastPinchDistance.value = null
}

function cloneMasks(value: FaceMask[]): FaceMask[] {
  return JSON.parse(JSON.stringify(value)) as FaceMask[]
}
</script>

<template>
  <section class="mask-editor" aria-labelledby="mask-heading">
    <header class="section-heading-row">
      <div>
        <h2 id="mask-heading" class="screen-heading">{{ image.name }}</h2>
        <p>사진 {{ image.sortOrder + 1 }} · 얼굴 {{ image.faceCount }}개 · 가림 {{ masks.length }}개</p>
      </div>
    </header>

    <div ref="container" class="mask-stage">
      <v-stage ref="stageRef" :config="{ width: stageWidth, height: stageHeight }" @touchmove="pinchMove" @touchend="pinchEnd">
        <v-layer>
          <v-image v-if="canvasImage" :config="{ image: canvasImage, width: stageWidth, height: stageHeight }" />
          <v-group
            v-for="mask in masks"
            :key="mask.id"
            :config="groupConfig(mask)"
            @click="selectMask(mask.id)"
            @tap="selectMask(mask.id)"
            @dragend="dragEnd(mask, $event)"
            @transformend="transformEnd(mask, $event)"
          >
            <v-ellipse v-if="mask.style !== 'sticker'" :config="{ x: groupConfig(mask).width / 2, y: groupConfig(mask).height / 2, radiusX: groupConfig(mask).width / 2, radiusY: groupConfig(mask).height / 2, fill: mask.style === 'white' ? '#FFFFFF' : 'rgba(72,72,72,.82)', shadowBlur: mask.style === 'blur' ? 16 : 0 }" />
            <v-rect v-else :config="{ width: groupConfig(mask).width, height: groupConfig(mask).height, fill: '#F0D7B5', cornerRadius: 999, stroke: '#2B2B2B', strokeWidth: 2 }" />
          </v-group>
          <v-transformer ref="transformerRef" v-if="selectedMask" :config="{ rotateEnabled: true, keepRatio: true, borderStroke: '#E7B98A', anchorFill: '#FFFFFF', anchorStroke: '#2B2B2B' }" />
        </v-layer>
      </v-stage>
    </div>

    <div class="mask-toolbar">
      <button type="button" @click="addMask">얼굴 추가</button>
      <button type="button" :disabled="!selectedMask" @click="deleteMask">가림 삭제</button>
      <button type="button" :disabled="history.length === 0" @click="undo">실행 취소</button>
    </div>

    <MaskStylePicker :selected="selectedStyle" :disabled="masks.length === 0" @select="chooseStyle" @apply-all="applyStyleToAll" />

    <div v-if="selectedMask" class="mask-sliders">
      <label>크기 <input type="range" min="0.12" max="0.6" step="0.01" :value="selectedMask.width" @input="updateSelected('width', Number(($event.target as HTMLInputElement).value))" /></label>
      <label>회전 <input type="range" min="-180" max="180" step="1" :value="selectedMask.rotation" @input="updateSelected('rotation', Number(($event.target as HTMLInputElement).value))" /></label>
    </div>
  </section>
</template>
