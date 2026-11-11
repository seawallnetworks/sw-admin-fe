<script setup lang="ts">
// Several sources, one address or network per line, with each bad line's error and line number.
import { computed } from 'vue'
import { NInput } from 'naive-ui'
import { parseAddrLines } from '../ace'

const text = defineModel<string>({ required: true })
defineProps<{ placeholder?: string }>()

const errors = computed(() => parseAddrLines(text.value).errors)
</script>

<template>
  <div class="lines">
    <NInput
      v-model:value="text"
      type="textarea"
      :autosize="{ minRows: 4, maxRows: 12 }"
      :placeholder="placeholder ?? '203.0.113.66\n198.51.100.0/24'"
      :status="errors.length ? 'error' : undefined"
      class="mono"
    />
    <ul v-if="errors.length" class="errors">
      <li v-for="e in errors" :key="e.line">Line {{ e.line }}: {{ e.error }}</li>
    </ul>
    <div class="hint">One address (192.0.2.7) or network (198.51.100.0/24) per line; one entry each.</div>
  </div>
</template>

<style scoped>
.lines {
  width: 100%;
}
.mono :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.errors {
  margin: 4px 0 0;
  padding-left: 18px;
  color: #d03050;
  font-size: 12px;
}
.hint {
  margin-top: 4px;
  font-size: 12px;
  color: #888;
}
</style>
