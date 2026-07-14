<script setup lang="ts">
import type { RewritePreview } from "./rewrite-actions"

defineProps<{ preview: RewritePreview }>()
</script>

<template>
  <aside class="rewrite-preview" aria-live="polite">
    <strong>최근 변경 · {{ preview.label }}</strong>
    <template v-if="preview.kind === 'title-body'">
      <p class="rewrite-preview__title">{{ preview.title }}</p>
      <p class="rewrite-preview__body">{{ preview.body }}</p>
    </template>
    <p v-else class="rewrite-preview__body">{{ preview.text }}</p>
  </aside>
</template>
