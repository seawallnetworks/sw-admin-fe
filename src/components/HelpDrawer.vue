<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { NAlert, NButton, NDrawer, NDrawerContent, NSpin } from 'naive-ui'
import { inlineParts, loadManual, type Section } from '../help'

defineProps<{ text?: boolean }>()

/** Manual sections for a page whose route names none (the pages still to come). */
const DEFAULT_SECTIONS = ['Layout', 'Roles', 'Saving the configuration']

const route = useRoute()
const show = ref(false)
const loading = ref(false)
const failed = ref(false)
const manual = ref<Section[]>([])

const sections = computed(() =>
  (route.meta.help ?? DEFAULT_SECTIONS)
    .map((title) => manual.value.find((s) => s.title === title))
    .filter((s): s is Section => s !== undefined),
)

async function open() {
  show.value = true
  if (manual.value.length) return
  loading.value = true
  failed.value = false
  try {
    manual.value = await loadManual()
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <NButton :text="text" :quaternary="!text" :size="text ? 'small' : 'medium'" @click="open">Help</NButton>
  <NDrawer v-model:show="show" width="min(480px, 100vw)" placement="right">
    <NDrawerContent :title="`Help: ${route.meta.title ?? ''}`" closable>
      <NSpin :show="loading">
        <NAlert v-if="failed" type="error" :show-icon="true">
          Help could not be loaded. Close this panel and try again.
        </NAlert>
        <section v-for="s in sections" :key="s.title" class="section">
          <h2>{{ s.title }}</h2>
          <template v-for="(b, i) in s.blocks" :key="i">
            <h3 v-if="b.kind === 'heading'">{{ b.text }}</h3>
            <p v-else-if="b.kind === 'para'">
              <template v-for="(part, j) in inlineParts(b.text)" :key="j">
                <code v-if="j % 2">{{ part }}</code><template v-else>{{ part }}</template>
              </template>
            </p>
            <div v-else class="item" :class="{ nested: b.level }">
              <span class="marker">{{ b.marker }}</span>
              <span>
                <template v-for="(part, j) in inlineParts(b.text)" :key="j">
                  <code v-if="j % 2">{{ part }}</code><template v-else>{{ part }}</template>
                </template>
              </span>
            </div>
          </template>
        </section>
      </NSpin>
      <template #footer>
        <div class="footer">
          <span>Tip: with this panel open, you can ask an AI assistant such as Gemini in Chrome about this page.</span>
          <a href="/llms.txt" target="_blank" rel="noopener">Full manual</a>
        </div>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped>
.section + .section {
  margin-top: 24px;
}
h2 {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
}
h3 {
  margin: 16px 0 6px;
  font-size: 14px;
  font-weight: 600;
}
p {
  margin: 0 0 8px;
  line-height: 1.6;
}
.item {
  display: flex;
  gap: 8px;
  margin: 0 0 6px;
  line-height: 1.6;
}
.item.nested {
  padding-left: 20px;
}
.marker {
  flex: none;
  min-width: 12px;
  color: #888;
}
code {
  padding: 0 4px;
  border-radius: 3px;
  background: #f2f3f5;
  font-size: 0.92em;
}
.footer {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  font-size: 12px;
  color: #888;
}
.footer a {
  flex: none;
}
</style>
