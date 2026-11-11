<script setup lang="ts">
// One interface's tab: whether its lists are enforced, "Test a packet", and its policy table.
import { computed, ref } from 'vue'
import { NAlert, NButton, NTag } from 'naive-ui'
import PolicyTable from './PolicyTable.vue'
import TestPacket from './TestPacket.vue'
import { STATUS_LABEL, STATUS_TYPE, useAclPage } from '../aclPage'
import { parseLimitRefusal, type Verdict } from '../policy'
import { deleteInterface } from '../api'

const props = defineProps<{ iface: string }>()
const page = useAclPage()

const status = computed(() => page.ifaceStatus(props.iface))
const engine = computed(() => page.engine.value)
const verdict = ref<Verdict | null>(null)
/** mfwd refused the policy because a list has too many entries: which, and how many to remove. */
const limitRefusal = computed(() => (engine.value?.state === 'refused' && engine.value.error ? parseLimitRefusal(engine.value.error) : null))
const hasLists = computed(() => !!page.config.value?.interfaces[props.iface]?.acls_in.length)

const statusText = computed(() => {
  const i = props.iface
  switch (status.value) {
    case 'enforced':
      return `The lists below are in force on ${i}.`
    case 'applying':
      return `The latest change hasn't reached the engine yet; ${i} may still run the previous lists.`
    case 'down':
      return `The engine isn't running; the device keeps retrying. ${i} may not be filtered by the lists below.`
    case 'refused':
      return `The engine refused the configuration; ${i} may still run the previous lists.`
    case 'off':
      return 'This device runs without the ACL engine: the lists below are not enforced.'
    case 'missing':
      return `There is no interface ${i} on this device, so these lists filter nothing. They start filtering if it appears.`
    case 'unfiltered':
      return hasLists.value
        ? `The engine is running but isn't filtering ${i}.`
        : `${i} applies no list: its incoming traffic isn't filtered.`
    case 'unknown':
      return page.engineError.value ? `Can't get the engine's state: ${page.engineError.value}` : 'Checking the engine…'
  }
  return ''
})

const fmt = (n: number) => n.toLocaleString('en-US')
const fmtTime = (t: number) => new Date(t * 1000).toLocaleString('en-US', { hourCycle: 'h23' })

/** An interface left with no list: its configuration can go. */
async function forget() {
  await page.mutate(() => deleteInterface(props.iface), `${props.iface} removed from the configuration`).catch(() => {})
}
</script>

<template>
  <div class="status" :class="`st-${status}`">
    <NTag :type="STATUS_TYPE[status]" size="small">{{ STATUS_LABEL[status] }}</NTag>
    <span>{{ statusText }}</span>
    <span v-if="status === 'enforced' && engine?.live && engine.counters" class="counters">
      Passed {{ fmt(engine.counters.xdp_pass ?? 0) }} · Dropped {{ fmt(engine.counters.xdp_drop ?? 0) }} packets
      (all interfaces)
    </span>
    <span v-if="engine && status !== 'unknown' && status !== 'missing'" class="muted">since {{ fmtTime(engine.since) }}</span>
  </div>
  <NAlert v-if="status === 'refused' && engine?.error" type="error" :bordered="false" class="gap">
    {{ engine.error }}
    <div v-if="limitRefusal" class="limit">
      List {{ limitRefusal.acl }} has {{ limitRefusal.count }} entries and can hold at most {{ limitRefusal.max }}:
      remove {{ limitRefusal.remove }} {{ limitRefusal.remove === 1 ? 'entry' : 'entries' }} from it. Until then the device
      keeps running the previous lists, and no access list change takes effect.
    </div>
  </NAlert>
  <p v-if="page.engineError.value && engine" class="muted small">Last refresh failed: {{ page.engineError.value }}</p>

  <TestPacket
    v-if="page.config.value"
    :config="page.config.value"
    :iface="iface"
    :status="status"
    @verdict="(v) => (verdict = v)"
  />

  <PolicyTable :iface="iface" :verdict="verdict" />

  <p class="muted small foot">
    Only incoming traffic is filtered; outgoing traffic isn't. Non-first IPv4 fragments skip stage 2, and the
    device may be set to drop IPv4 fragments altogether. Traffic that isn't IPv4 (ARP, IPv6) always passes. Changes take effect at once; Save Config keeps them. If a change cuts
    off your access, restarting the device restores the saved configuration.
  </p>
  <p v-if="!hasLists" class="small">
    <NButton text type="error" size="small" @click="forget">Remove {{ iface }} from the configuration</NButton>
  </p>
</template>

<style scoped>
.status {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  align-items: center;
  padding: 8px 12px;
  margin-bottom: 12px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.08);
  border-left: 4px solid #999;
}
.st-enforced {
  background: rgba(24, 160, 88, 0.08);
  border-left-color: #18a058;
}
.st-applying {
  background: rgba(32, 128, 240, 0.08);
  border-left-color: #2080f0;
}
.st-down,
.st-refused {
  background: rgba(208, 48, 80, 0.08);
  border-left-color: #d03050;
}
.st-missing {
  background: rgba(240, 160, 32, 0.08);
  border-left-color: #f0a020;
}
.counters {
  font-variant-numeric: tabular-nums;
}
.muted {
  color: #888;
}
.small {
  font-size: 12px;
}
.gap {
  margin-bottom: 12px;
}
.limit {
  margin-top: 6px;
  font-weight: 600;
}
.foot {
  margin: 8px 0 0;
}
</style>
