<script setup lang="ts">
// An interface's policy: stage 1 (its standard list) then stage 2 (its extended list), every entry
// a packet arriving on it can meet, in the order it meets them, with the actions on each.
import { computed, ref, watch } from 'vue'
import { NButton, NSpace, NTable } from 'naive-ui'
import { isStandard, listFill, policyRows, positionAfter, type PolicyRow, type Verdict } from '../policy'
import { sharedNote, useAclPage } from '../aclPage'

const props = defineProps<{ iface: string; verdict: Verdict | null }>()
const page = useAclPage()

const rows = computed(() => (page.config.value ? policyRows(page.config.value, props.iface) : []))

function hitClass(key: string) {
  const v = props.verdict
  return v && v.key === key ? (v.result === 'pass' ? 'hit hit-pass' : 'hit hit-drop') : ''
}

// ---------- the two-step delete: the first click arms it and says what happens, the second deletes ----------

const armed = ref<string | null>(null)
const deleting = ref(false)
watch([() => page.config.value, () => props.iface], () => (armed.value = null))

async function onDelete(r: Extract<PolicyRow, { kind: 'entry' }>) {
  const blocked = page.deleteBlocked(r.acl, r.seq)
  if (blocked) {
    page.message.error(blocked, { duration: 8000 })
    return
  }
  if (armed.value !== r.key) {
    armed.value = r.key
    return
  }
  deleting.value = true
  try {
    await page.deleteEntry(r.acl, r.seq)
  } finally {
    deleting.value = false
    armed.value = null
  }
}

function insertBelow(r: Extract<PolicyRow, { kind: 'entry' }>) {
  page.openAddEntry({ acl: r.acl, iface: props.iface, pos: positionAfter(page.entriesOf(r.acl), r.seq) })
}

/** "Add a standard/extended list": preselects a list of that kind no interface uses, else a new one. */
function addList(stage: 1 | 2) {
  const { notApplied } = page.unused.value
  if (stage === 1) {
    const free = notApplied.find(isStandard)
    page.openApply({ iface: props.iface, fixed: true, std: free ?? 'new' })
    return
  }
  // an empty extended list can't be applied, and a new one is empty
  const free = notApplied.find((a) => !isStandard(a) && page.entriesOf(a).length > 0)
  page.openApply({ iface: props.iface, fixed: true, ...(free !== undefined ? { ext: free } : {}) })
}

function changeList(stage: 1 | 2, acl: number) {
  page.openApply({ iface: props.iface, fixed: true, ...(stage === 1 ? { std: acl } : { ext: acl }) })
}

const also = (acl: number) => page.alsoOn(acl, props.iface)
const fill = (acl: number) => listFill(acl, page.entriesOf(acl).length)
</script>

<template>
  <NTable size="small" :single-line="false" class="policy">
    <thead>
      <tr>
        <th style="width: 64px">Seq</th>
        <th style="width: 100px">Protocol</th>
        <th>Source</th>
        <th>Destination</th>
        <th style="width: 26%">Result</th>
        <th style="width: 170px">Actions</th>
      </tr>
    </thead>
    <tbody>
      <template v-for="r in rows" :key="r.key">
        <tr v-if="r.kind === 'stage'" class="stage" :class="hitClass(r.key)">
          <td colspan="5">
            <div class="stage-title">
              {{ r.text }}
              <span v-if="r.acl !== null" class="fill" :class="{ near: fill(r.acl).nearFull }">
                · {{ fill(r.acl).count }} of {{ fill(r.acl).max }} entries
              </span>
            </div>
            <div v-if="r.acl !== null && also(r.acl).length" class="note">{{ sharedNote(also(r.acl)) }}</div>
          </td>
          <td>
            <NSpace v-if="r.acl !== null" :size="[10, 2]">
              <NButton text type="primary" size="small" @click="page.openAddEntry({ acl: r.acl, iface })">Add Entry</NButton>
              <NButton text size="small" @click="changeList(r.stage, r.acl)">Change list</NButton>
              <NButton text type="error" size="small" @click="page.removeFromIface(iface, r.acl)">Remove from {{ iface }}</NButton>
            </NSpace>
            <NButton v-else size="small" type="primary" secondary @click="addList(r.stage)">
              {{ r.stage === 1 ? 'Add a standard list' : 'Add an extended list' }}
            </NButton>
          </td>
        </tr>

        <tr v-else-if="r.kind === 'implicit'" class="implicit" :class="hitClass(r.key)">
          <td></td>
          <td colspan="3">{{ r.text }}</td>
          <td :class="`res-${r.resultType}`">→ {{ r.result }}</td>
          <td></td>
        </tr>

        <template v-else>
          <tr :class="[hitClass(r.key), { armed: armed === r.key }]">
            <td>{{ r.seq }}</td>
            <template v-if="r.view">
              <td>{{ r.view.protocol || 'Any' }}</td>
              <td>{{ r.view.source }}</td>
              <td>
                {{ r.view.destination || 'Any' }}
                <span v-if="r.view.options" class="opt">{{ r.view.options }}</span>
              </td>
            </template>
            <td v-else colspan="3"><code class="ace">{{ r.ace }}</code></td>
            <td>
              <span :class="`res-${r.resultType}`">{{ r.result }}</span>
              <div v-if="r.note" class="note" :class="{ warn: r.note.kind === 'warn' }">{{ r.note.text }}</div>
            </td>
            <td>
              <NSpace :size="[10, 2]">
                <NButton text size="small" @click="insertBelow(r)">Insert below</NButton>
                <NButton
                  size="small"
                  :text="armed !== r.key"
                  type="error"
                  :loading="deleting && armed === r.key"
                  @click="onDelete(r)"
                >
                  {{ armed === r.key ? 'Confirm delete' : 'Delete' }}
                </NButton>
              </NSpace>
            </td>
          </tr>
          <tr v-if="armed === r.key" class="explain">
            <td></td>
            <td colspan="5">
              Delete entry {{ r.seq }} of list {{ r.acl }} (<code class="ace">{{ r.ace }}</code>)?
              {{ page.deleteExplanation(r.acl, { seq: r.seq, ace: r.ace }, iface) }}
              <NButton text size="small" class="cancel" @click="armed = null">Cancel</NButton>
            </td>
          </tr>
        </template>
      </template>
    </tbody>
  </NTable>
</template>

<style scoped>
.stage td {
  background: var(--c-subtle-bg);
}
.stage-title {
  font-weight: 600;
}
.implicit td {
  font-style: italic;
  color: var(--c-muted);
}
.note {
  font-size: 12px;
  color: var(--c-muted);
}
.fill {
  font-weight: normal;
  font-size: 12px;
  color: var(--c-muted);
}
.fill.near {
  color: var(--c-warning-text);
  font-weight: 600;
}
.note.warn {
  color: var(--c-warning-text);
}
.opt {
  margin-left: 6px;
  font-size: 12px;
  color: var(--c-muted);
}
.res-drop {
  color: var(--c-error-text);
}
.res-pass {
  color: var(--c-success-text);
}
.res-next {
  color: var(--c-info-text);
}
.ace {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.armed td {
  background: var(--c-error-tint-weak);
}
.explain td {
  background: var(--c-error-tint-weak);
  color: var(--c-error-text);
  font-size: 13px;
}
.cancel {
  margin-left: 8px;
}
/* the row that decides for the tested packet: a tint and a 4px bar on the left */
.policy .hit td {
  background: var(--c-error-tint);
}
.policy .hit td:first-child {
  box-shadow: inset 4px 0 0 var(--c-error);
}
.policy .hit-pass td {
  background: var(--c-success-tint);
}
.policy .hit-pass td:first-child {
  box-shadow: inset 4px 0 0 var(--c-success);
}
</style>
