<script setup lang="ts">
// "Lists not in use": lists no interface applies, and lists applied only on interfaces that
// aren't on the device. Each expands to its entries.
import { computed, ref, watch } from 'vue'
import { NButton, NSpace, NTag } from 'naive-ui'
import { entryRows, isStandard, listFill } from '../policy'
import { useAclPage } from '../aclPage'

const page = useAclPage()

const groups = computed(() => [
  {
    key: 'none',
    title: 'Not applied to any interface',
    note: '',
    lists: page.unused.value.notApplied,
  },
  {
    key: 'missing',
    title: 'Applied only to interfaces that are not on this device',
    note: 'These would start filtering if the interface appeared.',
    lists: page.unused.value.onlyMissing,
  },
])

const open = ref(new Set<number>())
function toggle(acl: number) {
  const s = new Set(open.value)
  if (s.has(acl)) s.delete(acl)
  else s.add(acl)
  open.value = s
}

const rows = (acl: number) => (page.config.value ? entryRows(page.config.value, acl) : [])
const count = (acl: number) => page.entriesOf(acl).length
const fill = (acl: number) => listFill(acl, count(acl))
function why(acl: number, group: string) {
  return group === 'none' ? 'not applied' : `applied on ${page.appliedOn(acl).join(', ')}, not on this device`
}

// ---------- two-step deletes: of an entry ("acl:seq") or a list ("list:acl") ----------

const armed = ref<string | null>(null)
const busy = ref(false)
watch(() => page.config.value, () => (armed.value = null))

async function onDeleteEntry(acl: number, seq: number) {
  const blocked = page.deleteBlocked(acl, seq)
  if (blocked) {
    page.message.error(blocked, { duration: 8000 })
    return
  }
  const key = `${acl}:${seq}`
  if (armed.value !== key) {
    armed.value = key
    return
  }
  busy.value = true
  try {
    await page.deleteEntry(acl, seq)
  } finally {
    busy.value = false
    armed.value = null
  }
}

async function onDeleteList(acl: number) {
  const key = `list:${acl}`
  if (armed.value !== key) {
    armed.value = key
    return
  }
  busy.value = true
  try {
    await page.deleteList(acl)
  } finally {
    busy.value = false
    armed.value = null
  }
}

function apply(acl: number) {
  page.openApply({ iface: null, fixed: false, ...(isStandard(acl) ? { std: acl } : { ext: acl }) })
}
</script>

<template>
  <div class="head">
    <h3>Lists not in use</h3>
    <NButton type="primary" size="small" @click="page.openNewList()">New List</NButton>
  </div>

  <section v-for="g in groups" :key="g.key" class="group">
    <h4>{{ g.title }}</h4>
    <p v-if="g.note" class="muted small">{{ g.note }}</p>
    <p v-if="!g.lists.length" class="muted">None.</p>
    <div v-for="acl in g.lists" :key="acl" class="list">
      <div class="list-row">
        <button type="button" class="toggle" :aria-expanded="open.has(acl)" @click="toggle(acl)">
          <span class="caret" :class="{ open: open.has(acl) }">▸</span>
          <strong>List {{ acl }}</strong>
          · {{ isStandard(acl) ? 'Standard' : 'Extended' }}
          · <span :class="{ near: fill(acl).nearFull }">{{ count(acl) }} of {{ fill(acl).max }} entries</span>
          · <span class="muted">{{ why(acl, g.key) }}</span>
        </button>
        <NSpace :size="[12, 4]" align="center" class="actions">
          <NButton v-if="isStandard(acl) || count(acl)" text type="primary" size="small" @click="apply(acl)">
            Apply to an interface
          </NButton>
          <span v-else class="muted small">Add entries before applying it</span>
          <NButton text size="small" @click="page.openAddEntry({ acl, iface: null })">Add Entry</NButton>
          <template v-if="g.key === 'missing'">
            <NButton
              v-for="i in page.appliedOn(acl)"
              :key="i"
              text
              size="small"
              @click="page.removeFromIface(i, acl)"
            >
              Remove from {{ i }}
            </NButton>
          </template>
          <NButton
            size="small"
            type="error"
            :text="armed !== `list:${acl}`"
            :loading="busy && armed === `list:${acl}`"
            @click="onDeleteList(acl)"
          >
            {{ armed === `list:${acl}` ? 'Confirm delete' : 'Delete list' }}
          </NButton>
        </NSpace>
      </div>
      <div v-if="armed === `list:${acl}`" class="explain">
        Delete list {{ acl }}{{ count(acl) ? ` and its ${count(acl)} ${count(acl) === 1 ? 'entry' : 'entries'}` : '' }}?
        <template v-if="g.key === 'missing'">It is also removed from {{ page.appliedOn(acl).join(', ') }}.</template>
        <NButton text size="small" class="cancel" @click="armed = null">Cancel</NButton>
      </div>

      <div v-if="open.has(acl)" class="entries">
        <p v-if="!rows(acl).length" class="muted small">
          No entries.
          <template v-if="!isStandard(acl)">Applied as it is, this list drops all incoming traffic.</template>
        </p>
        <table v-else>
          <thead>
            <tr>
              <th>Seq</th>
              <th v-if="!isStandard(acl)">Protocol</th>
              <th>Source</th>
              <th v-if="!isStandard(acl)">Destination</th>
              <th>Result</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="r in rows(acl)" :key="r.key">
              <tr>
                <td>{{ r.seq }}</td>
                <template v-if="r.view">
                  <td v-if="!isStandard(acl)">{{ r.view.protocol }}</td>
                  <td>{{ r.view.source }}</td>
                  <td v-if="!isStandard(acl)">
                    {{ r.view.destination }}
                    <span v-if="r.view.options" class="muted small">{{ r.view.options }}</span>
                  </td>
                </template>
                <td v-else :colspan="isStandard(acl) ? 1 : 3"><code>{{ r.ace }}</code></td>
                <td>
                  {{ r.result }}
                  <div v-if="r.note" class="small" :class="r.note.kind === 'warn' ? 'warn' : 'muted'">{{ r.note.text }}</div>
                </td>
                <td class="right">
                  <NButton
                    size="small"
                    type="error"
                    :text="armed !== r.key"
                    :loading="busy && armed === r.key"
                    @click="onDeleteEntry(acl, r.seq)"
                  >
                    {{ armed === r.key ? 'Confirm delete' : 'Delete' }}
                  </NButton>
                </td>
              </tr>
              <tr v-if="armed === r.key">
                <td :colspan="isStandard(acl) ? 4 : 6" class="explain">
                  Delete entry {{ r.seq }} (<code>{{ r.ace }}</code>)? {{ page.deleteExplanation(acl, { seq: r.seq, ace: r.ace }, null) }}
                  <NButton text size="small" class="cancel" @click="armed = null">Cancel</NButton>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </section>
  <p v-if="!page.aclNumbers.value.length" class="muted">
    <NTag size="small">No lists</NTag> Click New List to create one.
  </p>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
h3 {
  margin: 0;
  font-size: 16px;
}
h4 {
  margin: 16px 0 6px;
  font-size: 14px;
}
.group p {
  margin: 0 0 6px;
}
.list {
  border: 1px solid var(--c-border);
  border-radius: 4px;
  margin-bottom: 8px;
}
.list-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 4px 12px;
  padding-right: 12px;
}
.toggle {
  flex: 1 1 320px;
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
.entries {
  padding: 0 12px 12px 32px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th,
td {
  text-align: left;
  padding: 4px 8px;
  border-bottom: 1px solid var(--c-border);
}
th {
  font-weight: 600;
  color: var(--c-muted);
}
.right {
  text-align: right;
}
.explain {
  padding: 6px 12px;
  background: var(--c-error-tint-weak);
  color: var(--c-error-text);
  font-size: 13px;
}
.cancel {
  margin-left: 8px;
}
.muted {
  color: var(--c-muted);
}
.small {
  font-size: 12px;
}
.warn {
  color: var(--c-warning-text);
}
.near {
  color: var(--c-warning-text);
  font-weight: 600;
}
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
</style>
