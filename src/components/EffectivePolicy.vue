<script setup lang="ts">
// The Effective Policy: every entry a packet arriving on an interface can meet, in the order it
// meets them, with "Test a packet" above it. Read only; the rows come from src/policy.ts.
import { computed, ref, watch } from 'vue'
import { NEmpty, NSelect, NSpace, NTable } from 'naive-ui'
import PacketTest from './PacketTest.vue'
import { policyRows, type Verdict } from '../policy'
import type { DeviceConfig } from '../types'

const props = defineProps<{ config: DeviceConfig['config'] }>()

const ifaceNames = computed(() => Object.keys(props.config.interfaces))
const iface = ref<string | null>(ifaceNames.value[0] ?? null)
watch(ifaceNames, (names) => {
  if (iface.value === null || !names.includes(iface.value)) iface.value = names[0] ?? null
})

const rows = computed(() => (iface.value === null ? [] : policyRows(props.config, iface.value)))
const verdict = ref<Verdict | null>(null)

function hitClass(key: string) {
  const v = verdict.value
  return v && v.key === key ? (v.result === 'pass' ? 'hit hit-pass' : 'hit hit-drop') : ''
}
</script>

<template>
  <NEmpty v-if="!ifaceNames.length" description="No interface has a configuration yet. Apply a list to one under Interfaces." />
  <template v-else>
    <NSpace align="center" :size="8" class="gap">
      <span>Interface</span>
      <NSelect
        v-model:value="iface"
        :options="ifaceNames.map((n) => ({ label: n, value: n }))"
        size="small"
        style="width: 180px"
      />
      <span class="muted">Incoming traffic on {{ iface }} meets these entries, top to bottom.</span>
    </NSpace>

    <PacketTest v-if="iface !== null" :config="config" :iface="iface" @verdict="(v) => (verdict = v)" />

    <NTable size="small" :single-line="false" class="policy">
      <thead>
        <tr>
          <th style="width: 44px">#</th>
          <th style="width: 64px">Seq</th>
          <th style="width: 100px">Protocol</th>
          <th>Source</th>
          <th>Destination</th>
          <th style="width: 30%">Result</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="r in rows" :key="r.key">
          <tr v-if="r.kind === 'header'" class="stage">
            <td colspan="6">{{ r.text }}</td>
          </tr>
          <tr v-else-if="r.kind === 'implicit'" class="implicit" :class="hitClass(r.key)">
            <td></td>
            <td></td>
            <td colspan="3">{{ r.text }}</td>
            <td :class="`res-${r.resultType}`">→ {{ r.result }}</td>
          </tr>
          <tr v-else :class="hitClass(r.key)">
            <td>{{ r.n }}</td>
            <td>{{ r.seq }}</td>
            <template v-if="r.view">
              <td>{{ r.view.protocol || 'Any' }}</td>
              <td>{{ r.view.source }}</td>
              <td>{{ r.view.destination || 'Any' }}</td>
            </template>
            <td v-else colspan="3"><code>{{ r.ace }}</code></td>
            <td>
              <span :class="`res-${r.resultType}`">{{ r.result }}</span>
              <div v-if="r.note" class="note">{{ r.note }}</div>
            </td>
          </tr>
        </template>
      </tbody>
    </NTable>
    <p class="muted foot">
      Outgoing traffic isn't filtered. Non-first IPv4 fragments skip stage 2, and traffic that isn't IPv4 (ARP, IPv6)
      always passes.
    </p>
  </template>
</template>

<style scoped>
.gap {
  margin-bottom: 12px;
}
.muted {
  color: #888;
}
.foot {
  margin: 8px 0 0;
  font-size: 12px;
}
.stage td {
  font-weight: 600;
  background: rgba(128, 128, 128, 0.08);
}
.implicit td {
  font-style: italic;
  color: #888;
}
.note {
  font-size: 12px;
  color: #888;
}
.res-drop {
  color: #d03050;
}
.res-pass {
  color: #18a058;
}
/* the row that decides for the tested packet: a tint and a 4px bar on the left */
.policy .hit td {
  background: rgba(208, 48, 80, 0.1);
}
.policy .hit td:first-child {
  box-shadow: inset 4px 0 0 #d03050;
}
.policy .hit-pass td {
  background: rgba(24, 160, 88, 0.1);
}
.policy .hit-pass td:first-child {
  box-shadow: inset 4px 0 0 #18a058;
}
</style>
