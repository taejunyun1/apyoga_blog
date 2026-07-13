<script setup lang="ts">
import type { RewritePreview } from "./rewrite-actions"

defineProps<{ preview: RewritePreview }>()
</script>

<template>
  <aside class="rewrite-preview" aria-live="polite">
    <strong>최근 변경 · {{ preview.label }}</strong>
    <p>{{ preview.text }}</p>
  </aside>
</template>
