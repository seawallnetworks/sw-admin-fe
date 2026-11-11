<script setup lang="ts">
// Add Entry for an extended list (stage 2): the form builds the entry (src/ace.ts), or it is typed.
import { computed, ref } from 'vue'
import {
  NAlert, NButton, NForm, NFormItem, NInput, NInputNumber, NModal, NRadio, NRadioGroup, NRadioButton, NSelect,
  NSpace, NSwitch, NTag,
} from 'naive-ui'
import AceAddrInput from './AceAddrInput.vue'
import AcePortInput from './AcePortInput.vue'
import {
  NAMED_PROTOCOLS, aceFormErrors, buildAce, emptyAceForm, hasPorts, type AceForm, type AceProtocol,
} from '../ace'
import { NO_ROOM, isVeryBroad, limitError, permitsTcpPort, placeEntries, positionOptions, shadowingEntry } from '../policy'
import { addAclEntry } from '../api'
import { CONSOLE_PORT, consoleWarning, sharedNote, useAclPage, type EntryRequest } from '../aclPage'

const props = defineProps<{ req: EntryRequest }>()
const emit = defineEmits<{ close: [] }>()
const page = useAclPage()

const acl = props.req.acl
const entries = computed(() => page.entriesOf(acl))
const also = computed(() => page.alsoOn(acl, props.req.iface))
const title = props.req.iface
  ? `Add to Stage 2 · List ${acl} (extended · ${props.req.iface})`
  : `Add to List ${acl} (extended)`

const form = ref<AceForm>(emptyAceForm(false))
const typeEntry = ref(false)
const typed = ref('')
const pos = ref(props.req.pos ?? 'end')

const ports = computed(() => hasPorts(form.value.protocol))
const built = computed(() => buildAce(form.value, false))
/** The entry as it would be sent: typed, or built by the form. */
const ace = computed(() => (typeEntry.value ? typed.value.trim() : built.value))

// ---------- position ----------

const positions = computed(() => positionOptions(entries.value))
const positionSelect = computed(() =>
  positions.value.map((o) => ({ label: o.seqs ? `${o.label} · seq ${o.seqs[0]}` : `${o.label} · no room`, value: o.key })),
)
const seq = computed(() => positions.value.find((o) => o.key === pos.value)?.seqs?.[0] ?? null)
const placed = computed(() => placeEntries(entries.value, [{ seq: seq.value ?? Infinity, ace: ace.value || '…' }]))

// ---------- warnings ----------

/** mini-fw binds at most 128 extended entries: over it, nothing can be added. */
const limitErr = computed(() => limitError(acl, entries.value.length, entries.value.length + 1))

const shadowedBy = computed(() => (seq.value === null ? null : shadowingEntry(entries.value, ace.value, seq.value, false)))
const veryBroad = computed(() => isVeryBroad(ace.value, false))
/** TODO(backend): with the console's interface in the API, check only that interface, and make it red. */
const consoleCut = computed(() => {
  const on = page.appliedOn(acl)
  return on.length && !permitsTcpPort([...entries.value, { seq: 0, ace: ace.value }], CONSOLE_PORT) ? on : null
})

// ---------- the form ----------

/** Destination port shortcuts; the number field takes any other port. */
const portChips: [string, number | null][] = [
  ['Any port', null],
  ['SSH 22', 22],
  ['DNS 53', 53],
  ['HTTP 80', 80],
  ['HTTPS 443', 443],
  [`Console ${Number(location.port) || 8443}`, Number(location.port) || 8443],
]
const chipOn = (port: number | null) => {
  const d = form.value.dstPort
  return port === null ? d.op === 'any' : d.op === 'eq' && d.port === port
}
function setDstPort(port: number | null) {
  form.value.dstPort = port === null ? { op: 'any', port: null, to: null } : { op: 'eq', port, to: null }
}

const protocolOptions: { label: string; value: AceProtocol }[] = [
  { label: 'IP (any protocol)', value: 'ip' },
  { label: 'TCP', value: 'tcp' },
  { label: 'UDP', value: 'udp' },
  { label: 'ICMP', value: 'icmp' },
  { label: 'Other (by number)', value: 'other' },
]

function onProtocol(p: AceProtocol) {
  const f = form.value
  f.protocol = p
  if (f.match === 'established' && p !== 'tcp') f.match = 'all'
  if (f.match === 'reply' && !hasPorts(p)) f.match = 'all'
}

/** A protocol number the device names is chosen by its name instead, so the port fields show; 0 is refused on Add. */
function onProtoNumber(n: number | null) {
  // the input also reports its value as it goes away, after a switch
  if (form.value.protocol !== 'other') return
  const named = n === null ? undefined : NAMED_PROTOCOLS[n]
  if (named) {
    onProtocol(named)
    form.value.protoNumber = null
    page.message.info(`Protocol ${n} is ${named.toUpperCase()}; switched to ${named.toUpperCase()}`)
    return
  }
  form.value.protoNumber = n
}

/** Switching to typing starts from what the form has built so far. */
function onTypeEntry(on: boolean) {
  typeEntry.value = on
  if (on && !typed.value.trim()) typed.value = built.value
}

// ---------- adding ----------

const submitting = ref(false)

async function onAdd() {
  if (typeEntry.value) {
    if (!typed.value.trim()) {
      page.message.warning('Enter the entry, for example "permit tcp any any eq 22"')
      return
    }
  } else {
    const f = form.value
    if (ports.value && f.dstPort.op === 'eq' && f.dstPort.port === null) {
      page.message.warning('Choose a destination port: one of the buttons, Any port, or a number')
      return
    }
    const errors = aceFormErrors(f, false)
    if (errors.length) {
      page.message.warning(errors[0])
      return
    }
  }
  if (limitErr.value) {
    page.message.warning(limitErr.value)
    return
  }
  if (seq.value === null) {
    page.message.warning(NO_ROOM)
    return
  }
  submitting.value = true
  try {
    await page.mutate(() => addAclEntry(acl, ace.value, seq.value!), `Entry added to list ${acl}`)
    emit('close')
  } catch {
    // keep the dialog open, with what was entered
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <NModal :show="true" preset="card" :title="title" style="width: 1020px; max-width: calc(100vw - 32px)" :mask-closable="false" @update:show="(v: boolean) => !v && emit('close')">
    <NAlert v-if="also.length" type="info" :bordered="false" class="shared">{{ sharedNote(also) }}</NAlert>
    <div class="layout">
      <NForm label-placement="left" label-width="110" class="form">
        <template v-if="!typeEntry">
          <NFormItem label="Action">
            <NRadioGroup v-model:value="form.action">
              <NRadioButton value="permit">Permit</NRadioButton>
              <NRadioButton value="deny">Deny</NRadioButton>
            </NRadioGroup>
          </NFormItem>
          <NFormItem label="Protocol">
            <NSpace :size="8" :wrap="false">
              <NSelect :value="form.protocol" :options="protocolOptions" style="width: 200px" @update:value="onProtocol" />
              <NInputNumber
                v-if="form.protocol === 'other'"
                :value="form.protoNumber"
                :min="0" :max="255"
                :show-button="false"
                :update-value-on-input="false"
                placeholder="0 to 255"
                style="width: 110px"
                @update:value="onProtoNumber"
              />
            </NSpace>
          </NFormItem>
          <NFormItem label="Source">
            <AceAddrInput v-model="form.src" />
          </NFormItem>
          <NFormItem v-if="ports" label="Source port">
            <AcePortInput v-model="form.srcPort" />
          </NFormItem>
          <NFormItem label="Destination">
            <AceAddrInput v-model="form.dst" />
          </NFormItem>
          <NFormItem v-if="ports" label="Destination port">
            <NSpace :size="6" align="center">
              <NButton
                v-for="[label, port] in portChips"
                :key="label"
                size="small"
                :type="chipOn(port) ? 'primary' : 'default'"
                :secondary="!chipOn(port)"
                @click="setDstPort(port)"
              >
                {{ label }}
              </NButton>
              <NInputNumber
                :value="form.dstPort.op === 'eq' ? form.dstPort.port : null"
                :min="1" :max="65535"
                :show-button="false"
                size="small"
                placeholder="Other port"
                style="width: 110px"
                @update:value="(p: number | null) => (form.dstPort = { op: 'eq', port: p, to: null })"
              />
            </NSpace>
          </NFormItem>
          <NFormItem v-if="ports" label="Match">
            <NRadioGroup v-model:value="form.match">
              <NSpace vertical :size="4">
                <NRadio value="all">All packets</NRadio>
                <NRadio v-if="form.protocol === 'tcp'" value="established">
                  Established connections only (packets with ACK or RST)
                </NRadio>
                <NRadio value="reply">Replies to connections this device opened</NRadio>
              </NSpace>
            </NRadioGroup>
          </NFormItem>
        </template>
        <NFormItem v-else label="Entry">
          <div class="field">
            <NInput v-model:value="typed" placeholder="permit tcp any any eq 22" class="ace-input" />
            <div class="hint">
              permit or deny, a protocol, a source and a destination, for example
              <code>permit tcp 192.168.1.0/24 any eq 22</code> or <code>deny ip host 203.0.113.66 any</code>.
            </div>
          </div>
        </NFormItem>
        <NFormItem label="Position">
          <div class="field">
            <NSelect v-model:value="pos" :options="positionSelect" />
            <div v-if="seq === null" class="error">{{ NO_ROOM }}</div>
            <div v-else class="hint">Entries are checked from the top; the first that matches decides.</div>
          </div>
        </NFormItem>
        <NFormItem v-if="!typeEntry" label="Entry">
          <code class="ace preview">{{ built }}</code>
        </NFormItem>
      </NForm>

      <div class="side">
        <div class="side-title">{{ req.iface ? 'Stage 2' : `List ${acl}` }} after the change</div>
        <ol class="after">
          <li v-for="e in placed" :key="(e.isNew ? 'n' : 'o') + e.seq" :class="{ 'is-new': e.isNew }">
            <span class="seq">{{ e.isNew ? (seq ?? '–') : e.seq }}</span>
            <code class="ace">{{ e.ace }}</code>
            <NTag v-if="e.isNew" size="tiny" type="info">new</NTag>
          </li>
          <li class="implicit">
            <span class="seq"></span>
            <span>Anything else → drop (implicit)</span>
          </li>
        </ol>
        <NAlert v-if="limitErr" type="error" :bordered="false" title="List full" class="warn">{{ limitErr }}</NAlert>
        <NAlert v-if="shadowedBy" type="warning" :bordered="false" title="Never matches" class="warn">
          Entry {{ shadowedBy.seq }} (<code>{{ shadowedBy.ace }}</code>) comes first and already matches every packet this
          one would. Choose a position above it, or narrow entry {{ shadowedBy.seq }}.
        </NAlert>
        <NAlert v-if="veryBroad" type="warning" :bordered="false" title="Very broad" class="warn">
          This permits all traffic from any source to any destination on every port. Entries after it never match, and
          the implicit deny no longer applies.
        </NAlert>
        <NAlert v-if="consoleCut" type="warning" :bordered="false" title="The console" class="warn">
          {{ consoleWarning(consoleCut) }}
        </NAlert>
      </div>
    </div>
    <template #footer>
      <NSpace justify="space-between" align="center">
        <NSpace :size="8" align="center">
          <NSwitch :value="typeEntry" size="small" @update:value="onTypeEntry" />
          <span class="muted">Type the entry</span>
        </NSpace>
        <NSpace>
          <NButton @click="emit('close')">Cancel</NButton>
          <NButton type="primary" :loading="submitting" :disabled="!!limitErr" @click="onAdd">Add Entry</NButton>
        </NSpace>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped src="./entryDialog.css"></style>
