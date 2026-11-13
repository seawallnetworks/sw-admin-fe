<script setup lang="ts">
// "Test a packet": describe a packet, see which row of the policy table decides for it.
// The verdict comes from src/policy.ts, which mirrors mini-fw; the device isn't asked.
import { computed, reactive, ref, watch } from 'vue'
import { NButton, NFormItem, NInput, NInputNumber, NSelect, NSpace, NTag } from 'naive-ui'
import { ipToInt } from '../ace'
import { evaluate, type Packet, type PacketState, type Verdict } from '../policy'
import type { DeviceConfig } from '../types'
import { statusCertainty, type IfaceStatus } from '../aclPage'

const props = defineProps<{ config: DeviceConfig['config']; iface: string; status: IfaceStatus }>()
/** Whether the verdict is what the device does now, may still be the previous lists, or isn't in force. */
const certainty = computed(() => statusCertainty(props.status))
/** The verdict, or null while collapsed or incomplete: the table highlights its row. */
const emit = defineEmits<{ verdict: [Verdict | null] }>()

// ---------- open or closed, remembered per browser ----------

const OPEN_KEY = 'sw_packet_test_open'
function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
}
const open = ref(readOpen())
function toggle() {
  open.value = !open.value
  try {
    localStorage.setItem(OPEN_KEY, open.value ? '1' : '0')
  } catch {
    // private window or blocked storage: it just isn't remembered
  }
}

// ---------- the packet ----------

type Proto = 'tcp' | 'udp' | 'icmp' | 'other'
const PROTO_NUMBER: Record<Exclude<Proto, 'other'>, number> = { tcp: 6, udp: 17, icmp: 1 }
const NAMED: Record<number, Proto> = { 1: 'icmp', 6: 'tcp', 17: 'udp' }

const f = reactive({
  proto: 'tcp' as Proto,
  protoNumber: null as number | null,
  src: '',
  sport: null as number | null,
  dst: '',
  dport: null as number | null,
  state: 'new' as PacketState,
})

const ports = computed(() => f.proto === 'tcp' || f.proto === 'udp')

const protoOptions = [
  { label: 'TCP', value: 'tcp' },
  { label: 'UDP', value: 'udp' },
  { label: 'ICMP', value: 'icmp' },
  { label: 'Other (by number)', value: 'other' },
]
const stateOptions = computed(() =>
  f.proto === 'tcp'
    ? [
        { label: 'New connection (SYN)', value: 'new' },
        { label: 'Established (ACK or RST set)', value: 'established' },
        { label: 'Reply to a connection this device opened', value: 'reply' },
      ]
    : f.proto === 'icmp'
      ? [
          { label: 'New: a ping in, or anything not a reply', value: 'new' },
          { label: 'Reply: an echo reply, or an error about this device\'s packet', value: 'reply' },
        ]
      : [
          { label: 'New (not a reply)', value: 'new' },
          { label: 'Reply to a connection this device opened', value: 'reply' },
        ],
)
// UDP has no "established"
watch(
  () => f.proto,
  (p) => {
    if (p !== 'tcp' && f.state === 'established') f.state = 'new'
  },
)

function onProtoNumber(n: number | null) {
  const named = n === null ? undefined : NAMED[n]
  if (named) {
    f.proto = named
    f.protoNumber = null
  } else {
    f.protoNumber = n
  }
}

// ---------- fill-in shortcuts: they only prefill, every field stays editable ----------

const hostIsIp = ipToInt(location.hostname) !== null
function fill(name: 'console' | 'ssh' | 'https' | 'dns' | 'ping') {
  switch (name) {
    case 'console':
      f.proto = 'tcp'
      if (hostIsIp) f.dst = location.hostname
      f.dport = Number(location.port) || 443
      break
    case 'ssh':
      f.proto = 'tcp'
      f.dport = 22
      break
    case 'https':
      f.proto = 'tcp'
      f.dport = 443
      break
    case 'dns':
      f.proto = 'udp'
      f.dport = 53
      break
    case 'ping':
      f.proto = 'icmp'
      break
  }
}

// ---------- checking and evaluating, on every input ----------

const srcBad = computed(() => f.src.trim() !== '' && ipToInt(f.src.trim()) === null)
const dstBad = computed(() => f.dst.trim() !== '' && ipToInt(f.dst.trim()) === null)

/** The packet, or the first field it still needs. */
const packet = computed<Packet | string>(() => {
  let proto: number
  if (f.proto === 'other') {
    if (f.protoNumber === null) return 'the protocol number'
    proto = f.protoNumber
  } else {
    proto = PROTO_NUMBER[f.proto]
  }
  const src = ipToInt(f.src.trim())
  if (src === null) return srcBad.value ? 'a valid source address' : 'the source address'
  const dst = ipToInt(f.dst.trim())
  if (dst === null) return dstBad.value ? 'a valid destination address' : 'the destination address'
  if (ports.value && f.dport === null) return 'the destination port'
  return {
    proto,
    src,
    dst,
    sport: ports.value ? f.sport : null,
    dport: ports.value ? f.dport : null,
    state: f.proto === 'tcp' || f.proto === 'udp' || f.proto === 'icmp' ? f.state : 'new',
  }
})

const verdict = computed(() =>
  open.value && typeof packet.value !== 'string' ? evaluate(props.config, props.iface, packet.value) : null,
)
watch(verdict, (v) => emit('verdict', v), { immediate: true })
</script>

<template>
  <div class="packet-test">
    <button type="button" class="toggle" :aria-expanded="open" aria-controls="packet-test-body" @click="toggle">
      <span class="caret" :class="{ open }">▸</span>
      <strong>Test a packet</strong> — see which entry decides for a packet you describe
    </button>

    <div v-if="open" id="packet-test-body" class="body">
      <NSpace :size="6" class="chips" align="center">
        <span class="muted">Fill in:</span>
        <NButton size="tiny" secondary @click="fill('console')">This console</NButton>
        <NButton size="tiny" secondary @click="fill('ssh')">SSH</NButton>
        <NButton size="tiny" secondary @click="fill('https')">HTTPS</NButton>
        <NButton size="tiny" secondary @click="fill('dns')">DNS</NButton>
        <NButton size="tiny" secondary @click="fill('ping')">Ping</NButton>
      </NSpace>

      <div class="grid">
        <NFormItem label="Protocol" :show-feedback="false">
          <NSpace :size="6" :wrap="false">
            <NSelect v-model:value="f.proto" :options="protoOptions" size="small" style="width: 160px" />
            <NInputNumber
              v-if="f.proto === 'other'"
              :value="f.protoNumber"
              :min="0" :max="255"
              :show-button="false"
              :update-value-on-input="false"
              size="small"
              placeholder="0 to 255"
              style="width: 90px"
              @update:value="onProtoNumber"
            />
          </NSpace>
        </NFormItem>
        <NFormItem v-if="ports || f.proto === 'icmp'" label="Packet" :show-feedback="false">
          <div style="width: 100%">
            <NSelect v-model:value="f.state" :options="stateOptions" size="small" />
            <div v-if="f.state === 'reply'" class="hint">
              Replies pass before the extended list, with no entry, when sw_flowd tracks the connection: UDP only
              to a port from 32768 to 60999. Without sw_flowd, any TCP packet with ACK or RST set and "fragmentation
              needed" pass so, and others go to the list.
            </div>
          </div>
        </NFormItem>
        <NFormItem label="Source address" :show-feedback="false">
          <NInput v-model:value="f.src" size="small" placeholder="For example 203.0.113.9" :status="srcBad ? 'error' : undefined" />
        </NFormItem>
        <NFormItem v-if="ports" label="Source port" :show-feedback="false">
          <NInputNumber v-model:value="f.sport" :min="1" :max="65535" :show-button="false" size="small" placeholder="Blank: unknown" />
        </NFormItem>
        <NFormItem label="Destination address" :show-feedback="false">
          <NInput v-model:value="f.dst" size="small" placeholder="An address of this device" :status="dstBad ? 'error' : undefined" />
        </NFormItem>
        <NFormItem v-if="ports" label="Destination port" :show-feedback="false">
          <NInputNumber v-model:value="f.dport" :min="1" :max="65535" :show-button="false" size="small" placeholder="For example 443" />
        </NFormItem>
      </div>

      <div class="result" aria-live="polite">
        <template v-if="typeof packet === 'string'">
          <span class="muted">Incomplete — enter {{ packet }}.</span>
        </template>
        <template v-else-if="verdict && certainty === 'not'">
          <NTag size="small">Not filtered</NTag>
          <span>
            Once enforced: <strong :class="`res-${verdict.result}`">{{ verdict.result === 'pass' ? 'passed' : 'dropped' }}</strong>.
            {{ verdict.text }}
          </span>
        </template>
        <template v-else-if="verdict">
          <NTag size="small" :type="verdict.result === 'pass' ? 'success' : 'error'">
            {{ verdict.result === 'pass' ? 'Passed' : 'Dropped' }}
          </NTag>
          <span>
            {{ verdict.text }}
            <span v-if="certainty === 'maybe'" class="muted">(may still be the previous lists)</span>
          </span>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.packet-test {
  margin-bottom: 12px;
  border: 1px solid var(--c-border);
  border-radius: 4px;
}
.toggle {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.toggle:hover {
  background: var(--c-subtle-bg);
}
.toggle:focus-visible {
  outline: 2px solid var(--c-success);
  outline-offset: -2px;
}
.caret {
  display: inline-block;
  margin-right: 6px;
  transition: transform 0.15s;
}
.caret.open {
  transform: rotate(90deg);
}
.body {
  padding: 4px 12px 12px;
}
.chips {
  margin-bottom: 8px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 8px 16px;
}
.result {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin-top: 12px;
}
.muted {
  color: var(--c-muted);
}
.hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--c-muted);
}
.res-drop {
  color: var(--c-error-text);
}
.res-pass {
  color: var(--c-success-text);
}
</style>
