<script setup lang="ts">
// Add Entry for a standard list (stage 1): deny or permit one or several sources.
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  NAlert, NButton, NForm, NFormItem, NInput, NModal, NRadioButton, NRadioGroup, NSelect, NSpace, NTag,
} from 'naive-ui'
import AddressLines from './AddressLines.vue'
import { ANY_NET, intToIp, netText, parseAddrLines, parseAddress, sameNet, stdAce, parseAceRule, type Net } from '../ace'
import {
  NO_ROOM, defaultStdPosition, limitError, listFill, placeEntries, positionOptions, shadowingEntry, stdPermitHasEffect,
} from '../policy'
import { addAclEntry } from '../api'
import { sharedNote, useAclPage, type EntryRequest } from '../aclPage'
import type { AclEntry } from '../types'

const props = defineProps<{ req: EntryRequest }>()
const emit = defineEmits<{ close: [] }>()
const page = useAclPage()

const acl = props.req.acl
const entries = computed(() => page.entriesOf(acl))
const also = computed(() => page.alsoOn(acl, props.req.iface))
const title = props.req.iface
  ? `Add to Stage 1 · List ${acl} (standard · ${props.req.iface})`
  : `Add to List ${acl} (standard)`

const action = ref<'deny' | 'permit'>('deny')
type SrcKind = 'host' | 'network' | 'any' | 'several'
const srcKind = ref<SrcKind>('host')
const srcValue = ref('')
const lines = ref('')
const pos = ref(props.req.pos ?? defaultStdPosition(entries.value))

// ---------- the sources to add ----------

/** The one source's error, once something is typed. */
const singleError = computed(() => {
  const v = srcValue.value.trim()
  if (srcKind.value === 'any' || srcKind.value === 'several' || !v) return null
  if (srcKind.value === 'host' && v.includes('/')) return 'That is a network: choose Network'
  if (srcKind.value === 'network' && !v.includes('/')) return 'Write the network with its prefix length, for example 198.51.100.0/24'
  return parseAddress(v).error ?? null
})

const existingNets = computed(() =>
  entries.value.map((e) => parseAceRule(e.ace, true)?.src).filter((n): n is Net => !!n),
)

/** The sources to add, duplicates and those already in the list left out; and how many were. */
const sources = computed<{ nets: { net: Net; text: string }[]; skipped: number; errors: number }>(() => {
  if (srcKind.value === 'any') return { nets: [{ net: ANY_NET, text: 'any' }], skipped: 0, errors: 0 }
  if (srcKind.value !== 'several') {
    const v = srcValue.value.trim()
    const r = parseAddress(v)
    return { nets: v && !singleError.value && r.net ? [{ net: r.net, text: v }] : [], skipped: 0, errors: 0 }
  }
  const parsed = parseAddrLines(lines.value)
  const nets: { net: Net; text: string }[] = []
  let skipped = 0
  for (const it of parsed.items) {
    if (nets.some((n) => sameNet(n.net, it.net)) || existingNets.value.some((n) => sameNet(n, it.net))) skipped++
    else nets.push({ net: it.net, text: it.text })
  }
  return { nets, skipped, errors: parsed.errors.length }
})
const count = computed(() => sources.value.nets.length)

/** The list's limit (mini-fw binds at most 64 standard entries): over it, nothing can be added. */
const room = computed(() => listFill(acl, entries.value.length).room)
const limitErr = computed(() =>
  count.value ? limitError(acl, entries.value.length, entries.value.length + count.value) : null,
)

// ---------- where they go ----------

const positions = computed(() => positionOptions(entries.value, Math.max(1, count.value)))
const positionSelect = computed(() =>
  positions.value.map((o) => ({
    label: o.seqs ? `${o.label} · seq ${o.seqs.length > 1 ? `${o.seqs[0]}–${o.seqs.at(-1)}` : o.seqs[0]}` : `${o.label} · no room`,
    value: o.key,
  })),
)
const seqs = computed(() => positions.value.find((o) => o.key === pos.value)?.seqs ?? null)

const newEntries = computed<(AclEntry & { net: Net })[]>(() =>
  seqs.value ? sources.value.nets.map((s, i) => ({ seq: seqs.value![i], ace: stdAce(action.value, s.net), net: s.net })) : [],
)
const placed = computed(() => placeEntries(entries.value, newEntries.value))
const resultOf = (ace: string) => (ace.startsWith('permit') ? 'go on' : 'drop')

// ---------- warnings ----------

const shadowed = computed(() =>
  newEntries.value
    .map((e) => ({ e, by: shadowingEntry(entries.value, e.ace, e.seq, true) }))
    .filter((x): x is { e: AclEntry & { net: Net }; by: AclEntry } => x.by !== null),
)
const noEffect = computed(
  () => action.value === 'permit' && newEntries.value.some((e) => !stdPermitHasEffect(entries.value, e.seq, e.net)),
)
const denyAny = computed(() => action.value === 'deny' && newEntries.value.some((e) => e.net.prefix === 0))
const wide = computed(() => newEntries.value.filter((e) => e.net.prefix > 0 && e.net.prefix < 16))
// TODO(backend): with the console's client address in the API, warn (red, "Add anyway") when a deny
// covers it: this would block the browser using the console.

// ---------- adding ----------

const submitting = ref(false)
const problem = computed(() => {
  if (srcKind.value === 'several' && sources.value.errors) return 'Fix the lines marked in red'
  if (limitErr.value) return limitErr.value
  if (!count.value) {
    if (srcKind.value === 'several' && sources.value.skipped) return 'Every address is already in the list'
    return singleError.value ?? 'Enter the source'
  }
  if (!seqs.value) return NO_ROOM
  return null
})

async function onAdd() {
  if (problem.value) {
    page.message.warning(problem.value)
    return
  }
  const todo = newEntries.value
  const added: string[] = []
  submitting.value = true
  try {
    for (const e of todo) {
      try {
        await addAclEntry(acl, e.ace, e.seq)
        added.push(netText(e.net))
      } catch {
        // api.ts showed why; keep what wasn't added
        if (srcKind.value === 'several') {
          const rest = sources.value.nets.slice(added.length).map((n) => n.text)
          lines.value = rest.join('\n')
        }
        if (added.length) page.message.info(`Added ${added.length} of ${todo.length}: ${added.join(', ')}. The rest are still in the box.`, { duration: 8000 })
        return
      }
    }
    page.message.success(todo.length === 1 ? `Entry added to list ${acl}` : `${todo.length} entries added to list ${acl}`)
    emit('close')
  } finally {
    submitting.value = false
    if (added.length) await page.refreshAfterChanges()
  }
}

const hostPlaceholder = 'For example 203.0.113.66'
const ipText = (n: Net) => intToIp(n.net)
</script>

<template>
  <NModal :show="true" preset="card" :title="title" style="width: 1020px; max-width: calc(100vw - 32px)" :mask-closable="false" @update:show="(v: boolean) => !v && emit('close')">
    <NAlert v-if="also.length" type="info" :bordered="false" class="shared">{{ sharedNote(also) }}</NAlert>
    <p class="intro muted">
      To block attack traffic automatically, use <RouterLink to="/ddos">DDoS Protection</RouterLink>.
    </p>
    <div class="layout">
      <NForm label-placement="left" label-width="90" class="form">
        <NFormItem label="Action">
          <div class="field">
            <NRadioGroup v-model:value="action">
              <NRadioButton value="deny">Deny (block)</NRadioButton>
              <NRadioButton value="permit">Permit (exempt)</NRadioButton>
            </NRadioGroup>
            <div class="hint">
              <template v-if="action === 'deny'">Deny drops the packet: stage 2 never sees it.</template>
              <template v-else>
                Permit lets the source skip the deny entries after it and go on to stage 2. Place it before the deny
                it is an exception to.
              </template>
            </div>
          </div>
        </NFormItem>
        <NFormItem label="Source">
          <div class="field">
            <NRadioGroup v-model:value="srcKind" size="small">
              <NRadioButton value="host">Host</NRadioButton>
              <NRadioButton value="network">Network</NRadioButton>
              <NRadioButton value="any">Any</NRadioButton>
              <NRadioButton value="several">Several</NRadioButton>
            </NRadioGroup>
            <div v-if="srcKind === 'host' || srcKind === 'network'" style="margin-top: 6px">
              <NInput
                v-model:value="srcValue"
                :placeholder="srcKind === 'host' ? hostPlaceholder : 'For example 198.51.100.0/24'"
                :status="singleError ? 'error' : undefined"
              />
              <div v-if="singleError" class="error">{{ singleError }}</div>
            </div>
            <div v-else-if="srcKind === 'several'" style="margin-top: 6px">
              <AddressLines v-model="lines" />
              <div v-if="limitErr && count > 1" class="error">
                Only {{ room }} of the {{ count }} addresses fit in list {{ acl }}.
              </div>
              <div v-if="sources.skipped" class="hint">
                {{ sources.skipped }} {{ sources.skipped === 1 ? 'address is' : 'addresses are' }} a duplicate or already
                in the list; skipped.
              </div>
            </div>
          </div>
        </NFormItem>
        <NFormItem label="Position">
          <div class="field">
            <NSelect v-model:value="pos" :options="positionSelect" />
            <div v-if="!seqs" class="error">{{ NO_ROOM }}</div>
            <div v-else class="hint">The first entry that matches the source decides.</div>
          </div>
        </NFormItem>
        <NFormItem v-if="newEntries.length === 1" label="Entry">
          <code class="ace preview">{{ newEntries[0].ace }}</code>
        </NFormItem>
      </NForm>

      <div class="side">
        <div class="side-title">Stage 1 after the change</div>
        <ol class="after">
          <li v-for="e in placed" :key="(e.isNew ? 'n' : 'o') + e.seq" :class="{ 'is-new': e.isNew }">
            <span class="seq">{{ e.seq }}</span>
            <code class="ace">{{ e.ace }}</code>
            <NTag v-if="e.isNew" size="tiny" type="info">new</NTag>
            <span class="res">{{ resultOf(e.ace) }}</span>
          </li>
          <li class="implicit">
            <span class="seq"></span>
            <span>Anything else goes on to stage 2</span>
          </li>
        </ol>
        <NAlert v-if="limitErr" type="error" :bordered="false" title="List full" class="warn">{{ limitErr }}</NAlert>
        <NAlert v-if="denyAny" type="error" :bordered="false" title="Drops everything" class="warn">
          A deny for any source drops all incoming traffic in stage 1, this console's connection included.
        </NAlert>
        <NAlert v-for="s in shadowed" :key="s.e.seq" type="warning" :bordered="false" title="Never matches" class="warn">
          Entry {{ s.by.seq }} (<code>{{ s.by.ace }}</code>) comes first and already matches
          {{ s.e.net.prefix === 0 ? 'every source' : netText(s.e.net) }}. Choose a position above it.
        </NAlert>
        <NAlert v-if="noEffect" type="info" :bordered="false" title="No effect here" class="warn">
          No deny after this position covers the source, so the permit changes nothing: a standard list already lets on
          what it doesn't deny. Put it before the deny it is an exception to.
        </NAlert>
        <NAlert v-if="wide.length" type="warning" :bordered="false" title="Large network" class="warn">
          {{ wide.map((e) => `${ipText(e.net)}/${e.net.prefix}`).join(', ') }}
          {{ wide.length === 1 ? 'covers' : 'cover' }} more than 65,536 addresses. Check the prefix length.
        </NAlert>
      </div>
    </div>
    <template #footer>
      <NSpace justify="end">
        <NButton @click="emit('close')">Cancel</NButton>
        <NButton type="primary" :loading="submitting" :disabled="!!limitErr" @click="onAdd">
          {{ count > 1 ? `Add ${count} entries` : 'Add Entry' }}
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped src="./entryDialog.css"></style>
<style scoped>
.intro {
  margin: 0 0 12px;
  font-size: 13px;
}
.intro a {
  color: var(--c-info-text);
}
</style>
