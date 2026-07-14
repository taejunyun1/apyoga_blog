<script setup lang="ts">
import { nextTick, ref, watch } from "vue"

const props = defineProps<{
  open: boolean
  title: string
  description: string
  busy: boolean
  error: string | null
}>()

const emit = defineEmits<{
  cancel: []
  confirm: []
}>()

const cancelButton = ref<HTMLButtonElement | null>(null)

watch(() => props.open, async (open) => {
  if (!open) return
  await nextTick()
  cancelButton.value?.focus()
})

function cancel() {
  if (!props.busy) emit("cancel")
}
</script>

<template>
  <div
    v-if="open"
    class="history-dialog-backdrop"
    @click.self="cancel"
    @keydown.esc.stop.prevent="cancel"
  >
    <section
      class="history-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="history-dialog-title"
      aria-describedby="history-dialog-description"
    >
      <h2 id="history-dialog-title">{{ title }}</h2>
      <p id="history-dialog-description">{{ description }}</p>
      <p v-if="error" class="history-dialog__error" role="alert">{{ error }}</p>
      <div class="history-dialog__actions">
        <button
          ref="cancelButton"
          type="button"
          class="history-dialog__cancel"
          data-action="cancel"
          :disabled="busy"
          @click="cancel"
        >
          취소
        </button>
        <button
          type="button"
          class="history-dialog__delete"
          data-action="confirm"
          :disabled="busy"
          @click="emit('confirm')"
        >
          {{ busy ? '삭제 중…' : '삭제' }}
        </button>
      </div>
    </section>
  </div>
</template>
