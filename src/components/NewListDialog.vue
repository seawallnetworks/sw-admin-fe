<script setup lang="ts">
// New List: a standard list to block sources, or an extended list to allow services, started
// empty, from a template, or as a copy of another list. Opened from the Apply dialog (`kind` given),
// the kind is fixed, it can't start empty, and it reports the list it created instead of showing it.
import { computed, ref, watch } from 'vue'
import { NAlert, NButton, NForm, NFormItem, NInput, NInputNumber, NModal, NRadio, NRadioGroup, NSpace } from 'naive-ui'
import AddressLines from './AddressLines.vue'
import { parseAddrLines, parseAddress, sameNet, stdAce, type Net } from '../ace'
import { EXT_RANGE, STD_MAX_ENTRIES, STD_RANGE, isStandard, nextFreeList, permitsTcpPort } from '../policy'
import { addAclEntry, createAcl } from '../api'
import { CONSOLE_PORT, useAclPage } from '../aclPage'
import type { AclEntry } from '../types'

const props = defineProps<{ kind?: 'std' | 'ext' }>()
const emit = defineEmits<{ close: []; created: [acl: number] }>()
const page = useAclPage()
const config = computed(() => page.config.value!)

type Kind = 'std' | 'ext'
const fixed = !!props.kind
const kind = ref<Kind>(props.kind ?? 'std')
const standard = computed(() => kind.value === 'std')
const range = computed(() => (standard.value ? STD_RANGE : EXT_RANGE))

const number = ref<number | null>(nextFreeList(config.value, kind.value === 'std'))
/** 'addresses' | 'basic' | 'empty' | 'copy-<n>' */
const start = ref(kind.value === 'std' ? 'addresses' : 'basic')
const lines = ref('')
/**
 * The management network: where the console is used from.
 * TODO(backend): the console's client address isn't in the API; with it, prefill its network.
 */
const mgmt = ref('')

watch(kind, (k) => {
  number.value = nextFreeList(config.value, k === 'std')
  start.value = k === 'std' ? 'addresses' : 'basic'
})

const inUse = computed(() => page.aclNumbers.value.filter((a) => isStandard(a) === standard.value))
const numberError = computed(() => {
  const [lo, hi] = range.value
  const n = number.value
  if (n === null || !Number.isInteger(n) || n < lo || n > hi) return `Enter a number from ${lo} to ${hi}`
  if (String(n) in config.value.acls) return `List ${n} exists`
  return null
})

const startOptions = computed(() => [
  ...(standard.value
    ? [{ value: 'addresses', label: 'Addresses to deny' }]
    : [{ value: 'basic', label: 'Basic protection (recommended)' }]),
  ...(fixed ? [] : [{ value: 'empty', label: 'Empty' }]),
  ...inUse.value.map((a) => ({ value: `copy-${a}`, label: `A copy of list ${a}` })),
])

// ---------- the entries it starts with ----------

const mgmtNet = computed(() => (mgmt.value.trim() ? parseAddress(mgmt.value) : null))
const mgmtError = computed(() => {
  if (start.value !== 'basic') return null
  if (!mgmtNet.value) return 'Enter the network you manage the device from, for example 192.168.1.0/24'
  return mgmtNet.value.error ?? null
})

const addrs = computed(() => parseAddrLines(lines.value))
const linesSkipped = computed(() => {
  const seen: Net[] = []
  let dup = 0
  for (const it of addrs.value.items) {
    if (seen.some((n) => sameNet(n, it.net))) dup++
    else seen.push(it.net)
  }
  return { nets: seen, dup }
})

const entries = computed<AclEntry[]>(() => {
  const s = start.value
  const numbered = (aces: string[]) => aces.map((ace, i) => ({ seq: (i + 1) * 10, ace }))
  if (s === 'addresses') return numbered(linesSkipped.value.nets.map((n) => stdAce('deny', n)))
  if (s === 'basic') {
    const net = mgmtNet.value?.net
    const src = !net ? 'A.B.C.D/len' : stdAce('permit', net).replace(/^permit /, '')
    return numbered([
      `permit tcp ${src} any eq ${CONSOLE_PORT}`,
      `permit tcp ${src} any eq 22`,
      'permit tcp any any established',
      'permit udp any any reply',
      'permit icmp any any',
    ])
  }
  if (s.startsWith('copy-')) return page.entriesOf(Number(s.slice(5))).map((e) => ({ ...e }))
  return []
})

/** "Addresses to deny" over a standard list's limit (mini-fw binds at most 64). Copies can't exceed it. */
const limitErr = computed(() => {
  const k = entries.value.length
  return start.value === 'addresses' && k > STD_MAX_ENTRIES
    ? `List ${number.value ?? ''} can hold at most ${STD_MAX_ENTRIES} entries; these lines make ${k}. Remove ${k - STD_MAX_ENTRIES}.`
    : null
})

const emptyExt = computed(() => !standard.value && !entries.value.length)
const copyNoConsole = computed(
  () => !standard.value && start.value.startsWith('copy-') && entries.value.length > 0 && !permitsTcpPort(entries.value, CONSOLE_PORT),
)

// ---------- creating ----------

const submitting = ref(false)
const problem = computed(() => {
  if (numberError.value) return numberError.value
  if (start.value === 'addresses' && addrs.value.errors.length) return 'Fix the lines marked in red'
  if (limitErr.value) return limitErr.value
  if (mgmtError.value) return mgmtError.value
  return null
})

async function onCreate() {
  if (problem.value) {
    page.message.warning(problem.value)
    return
  }
  const acl = number.value!
  const todo = entries.value
  if (fixed && !todo.length) {
    page.message.warning('Add the entries the list starts with')
    return
  }
  let created = false
  let done = 0
  submitting.value = true
  try {
    await createAcl(acl)
    created = true
    for (const e of todo) {
      await addAclEntry(acl, e.ace, e.seq)
      done++
    }
    page.message.success(todo.length ? `List ${acl} created with ${todo.length} ${todo.length === 1 ? 'entry' : 'entries'}` : `List ${acl} created`)
  } catch {
    // api.ts showed why. The list exists if it was created: say which entries it lacks.
    if (created) {
      const missing = todo.slice(done).map((e) => e.ace)
      page.message.warning(
        `List ${acl} was created, but ${missing.length} ${missing.length === 1 ? 'entry is' : 'entries are'} missing: ${missing.join('; ')}`,
        { duration: 15000 },
      )
    }
  } finally {
    await page.refreshAfterChanges()
    submitting.value = false
  }
  // after the refresh, so the list is in the page's lists with its entries
  if (created) {
    if (fixed) emit('created', acl)
    else page.goTo(page.UNUSED_TAB)
    emit('close')
  }
}
</script>

<template>
  <NModal :show="true" preset="card" :title="!fixed ? 'New List' : standard ? 'New Standard List' : 'New Extended List'" :style="{ width: fixed ? '880px' : '1020px', maxWidth: 'calc(100vw - 32px)' }" :mask-closable="false" @update:show="(v: boolean) => !v && emit('close')">
    <div class="layout">
      <NForm label-placement="top" class="form">
        <NFormItem v-if="!fixed" label="What is it for?">
          <div class="cards" role="radiogroup">
            <button type="button" role="radio" :aria-checked="kind === 'std'" class="card" :class="{ on: kind === 'std' }" @click="kind = 'std'">
              <strong>Block sources</strong>
              <span>Standard list, 1-99. Checked first, by source address only. For blocklists.</span>
            </button>
            <button type="button" role="radio" :aria-checked="kind === 'ext'" class="card" :class="{ on: kind === 'ext' }" @click="kind = 'ext'">
              <strong>Allow services</strong>
              <span>Extended list, 100-199. Lets in what you permit and drops the rest.</span>
            </button>
          </div>
        </NFormItem>
        <NFormItem label="Number">
          <div class="field">
            <NInputNumber
              v-model:value="number"
              :min="range[0]" :max="range[1]"
              :status="numberError ? 'error' : undefined"
              style="width: 140px"
            />
            <div v-if="numberError" class="error">{{ numberError }}</div>
            <div class="hint">
              {{ range[0] }} to {{ range[1] }}.
              {{ inUse.length ? `In use: ${inUse.join(', ')}.` : 'None in use yet.' }}
            </div>
          </div>
        </NFormItem>
        <NFormItem label="Start with">
          <div class="field">
            <NRadioGroup v-model:value="start">
              <NSpace vertical :size="6">
                <NRadio v-for="o in startOptions" :key="o.value" :value="o.value">{{ o.label }}</NRadio>
              </NSpace>
            </NRadioGroup>
            <div v-if="start === 'addresses'" style="margin-top: 8px">
              <AddressLines v-model="lines" />
              <div v-if="linesSkipped.dup" class="hint">{{ linesSkipped.dup }} duplicate {{ linesSkipped.dup === 1 ? 'line' : 'lines' }} skipped.</div>
            </div>
            <div v-if="start === 'basic'" style="margin-top: 8px">
              <div class="label">Management network</div>
              <NInput v-model:value="mgmt" placeholder="For example 192.168.1.0/24" :status="mgmt && mgmtError ? 'error' : undefined" />
              <div v-if="mgmt && mgmtError" class="error">{{ mgmtError }}</div>
              <div class="hint">
                Where you manage the device from: it may reach this console (TCP {{ CONSOLE_PORT }}) and SSH. Replies to
                connections, and ping, are let in from anywhere.
              </div>
            </div>
          </div>
        </NFormItem>
      </NForm>

      <div class="side">
        <div class="side-title">List {{ number ?? '…' }} as it will be created</div>
        <ol class="after">
          <li v-for="e in entries" :key="e.seq" class="is-new">
            <span class="seq">{{ e.seq }}</span>
            <code class="ace">{{ e.ace }}</code>
          </li>
          <li class="implicit">
            <span class="seq"></span>
            <span>{{ standard ? 'Anything else goes on to stage 2' : 'Anything else → drop (implicit)' }}</span>
          </li>
        </ol>
        <NAlert v-if="limitErr" type="error" :bordered="false" title="Too many entries" class="warn">{{ limitErr }}</NAlert>
        <NAlert v-if="emptyExt" type="error" :bordered="false" title="Drops everything once applied" class="warn">
          An empty extended list drops all incoming traffic on the interface it is applied to, this console's connection
          included. Add entries before applying it.
        </NAlert>
        <NAlert v-if="copyNoConsole" type="warning" :bordered="false" title="The console" class="warn">
          The copied list doesn't permit TCP port {{ CONSOLE_PORT }}, the port of this console. Applied to the interface
          you manage the device through, it cuts off the console.
        </NAlert>
        <p v-if="fixed" class="muted small">Created, it is chosen in the Apply dialog; Apply there applies it.</p>
        <p v-else class="muted small">A new list does nothing until you apply it to an interface.</p>
      </div>
    </div>
    <template #footer>
      <NSpace justify="end">
        <NButton @click="emit('close')">Cancel</NButton>
        <NButton type="primary" :loading="submitting" :disabled="!!limitErr" @click="onCreate">
          {{ entries.length ? `Create list with ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}` : 'Create list' }}
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped src="./entryDialog.css"></style>
<style scoped>
.cards {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  width: 100%;
}
.card {
  flex: 1 1 200px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--c-border-strong);
  border-radius: 6px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.card span {
  font-size: 12px;
  color: var(--c-muted);
}
.card.on {
  border-color: var(--c-success);
  box-shadow: inset 0 0 0 1px var(--c-success);
  background: var(--c-success-tint);
}
.card:focus-visible {
  outline: 2px solid var(--c-success);
  outline-offset: 2px;
}
.label {
  font-size: 13px;
  margin-bottom: 4px;
}
.small {
  font-size: 12px;
}
</style>
