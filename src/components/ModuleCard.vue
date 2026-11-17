<script setup lang="ts">
// One module on the Dashboard: its state in a word or two, a few figures, and the whole card a link to
// the module's page.
import { RouterLink } from 'vue-router'
import { NCard } from 'naive-ui'
import type { Tone } from '../overview'

defineProps<{
  title: string
  to: string
  status: string
  tone: Tone
  /** A bar down the left edge, for a state that needs a look now. */
  bar?: boolean
  note?: string
  stats: { label: string; value: string }[]
}>()
</script>

<template>
  <RouterLink :to="to" class="link">
    <NCard hoverable size="small" class="card" :class="[`tone-${tone}`, { bar }]">
      <div class="title">{{ title }}</div>
      <div class="status">
        <span class="dot" />
        {{ status }}
      </div>
      <div v-if="note" class="note">{{ note }}</div>
      <dl class="stats">
        <div v-for="s in stats" :key="s.label">
          <dt>{{ s.label }}</dt>
          <dd>{{ s.value }}</dd>
        </div>
      </dl>
    </NCard>
  </RouterLink>
</template>

<style scoped>
.link {
  display: block;
  height: 100%;
  color: inherit;
  text-decoration: none;
}
.card {
  height: 100%;
  --tone: var(--c-muted);
  --tone-text: var(--c-muted);
}
.card.bar {
  box-shadow: inset 4px 0 0 var(--tone);
}
.tone-success {
  --tone: var(--c-success);
  --tone-text: var(--c-success-text);
}
.tone-info {
  --tone: var(--c-info);
  --tone-text: var(--c-info-text);
}
.tone-warning {
  --tone: var(--c-warning);
  --tone-text: var(--c-warning-text);
}
.tone-error {
  --tone: var(--c-error);
  --tone-text: var(--c-error-text);
}
.title {
  color: var(--c-muted);
  font-size: 13px;
}
.status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 20px;
  font-weight: 600;
  color: var(--tone-text);
}
.dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--tone);
}
.note {
  margin-top: 4px;
  color: var(--c-muted);
  font-size: 13px;
}
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  margin: 12px 0 0;
}
.stats dt {
  color: var(--c-muted);
  font-size: 12px;
}
.stats dd {
  margin: 0;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}
</style>
