<script setup lang="ts">
import { computed } from "vue"
import { rewriteActionKey, rewriteActionsFor } from "./rewrite-actions"

const props = defineProps<{
  channel: "naver" | "instagram"
  pendingKey: string | null
}>()
defineEmits<{ rewrite: [request: { channel: "naver" | "instagram"; section: string; instruction: string }] }>()

const actions = computed(() => rewriteActionsFor(props.channel))
</script>
<template>
  <section class="rewrite-actions" aria-label="부분 다시 쓰기">
    <button
      v-for="action in actions"
      :key="rewriteActionKey(action)"
      type="button"
      :disabled="pendingKey !== null"
      :aria-busy="pendingKey === rewriteActionKey(action)"
      :aria-label="action.accessibleLabel ? `${action.accessibleLabel}${pendingKey === rewriteActionKey(action) ? ' 변경 중…' : ''}` : undefined"
      @click="$emit('rewrite', { channel: action.channel, section: action.section, instruction: action.instruction })"
    >
      {{ action.label }}{{ pendingKey === rewriteActionKey(action) ? ' 변경 중…' : '' }}
    </button>
  </section>
</template>
