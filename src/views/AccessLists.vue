<script setup lang="ts">
// Access Lists, by interface: a tab per interface (its status, "Test a packet" and its policy),
// "Lists not in use", and the dialogs that change them. The state is in src/aclPage.ts.
import { computed, ref } from 'vue'
import { NAlert, NButton, NCard, NEmpty, NResult, NSelect, NSpin, NTag } from 'naive-ui'
import InterfacePolicy from '../components/InterfacePolicy.vue'
import UnusedLists from '../components/UnusedLists.vue'
import StdEntryDialog from '../components/StdEntryDialog.vue'
import ExtEntryDialog from '../components/ExtEntryDialog.vue'
import ApplyListsDialog from '../components/ApplyListsDialog.vue'
import NewListDialog from '../components/NewListDialog.vue'
import { provideAclPage } from '../aclPage'
import { isStandard } from '../policy'
import { USE_MOCK, getRole } from '../api'

// Every call on this page is admin only: a `user` gets 403 even for reading the lists.
const isAdmin = getRole() === 'admin'
const page = provideAclPage()
if (isAdmin) page.start()

/**
 * mfwd answers without sw_flowd's table: a broken install, not a state to run in (Seawall proposal 0015
 * §6). Shown on every tab while it lasts: it concerns all interfaces.
 */
const noFlowTable = computed(() => !!page.engine.value?.live && page.engine.value.flows === 'none')

const unusedCount = computed(() => page.unused.value.notApplied.length + page.unused.value.onlyMissing.length)
const tabs = computed(() => [...page.ifaceNames.value, page.UNUSED_TAB])

/** Arrow keys move between tabs, as in any tab list. */
function onTabKey(e: KeyboardEvent) {
  const i = tabs.value.indexOf(page.tab.value ?? '')
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
  if (!step || i < 0) return
  e.preventDefault()
  const next = tabs.value[(i + step + tabs.value.length) % tabs.value.length]
  page.goTo(next)
  ;(document.getElementById(`tab-${next}`) as HTMLElement | null)?.focus()
}

// ---------- mock mode only: try each engine state ----------

const mockState = ref('auto')
const mockStates = ['auto', 'applied', 'pending', 'unreachable', 'refused', 'off'].map((s) => ({ label: s, value: s }))
function setMockState(s: string) {
  mockState.value = s
  ;(globalThis as { mockEngineState?: (s: string) => void }).mockEngineState?.(s)
  page.pollEngine()
}

const mockFlows = ref('sw_flowd')
const mockFlowsOptions = ['sw_flowd', 'none'].map((s) => ({ label: s, value: s }))
function setMockFlows(s: string) {
  mockFlows.value = s
  ;(globalThis as { mockFlows?: (s: string) => void }).mockFlows?.(s)
  page.pollEngine()
}
</script>

<template>
  <NResult
    v-if="!isAdmin"
    status="403"
    title="Administrators only"
    description="Viewing and changing the access lists needs an administrator account."
  />

  <NCard v-else title="Access Lists" size="small">
    <template v-if="USE_MOCK" #header-extra>
      <span class="mock">
        Mock engine state
        <NSelect :value="mockState" :options="mockStates" size="tiny" style="width: 120px" @update:value="setMockState" />
        Mock flows
        <NSelect :value="mockFlows" :options="mockFlowsOptions" size="tiny" style="width: 100px" @update:value="setMockFlows" />
      </span>
    </template>

    <NSpin v-if="!page.config.value" :show="page.loading.value" style="min-height: 120px; display: block">
      <NEmpty v-if="!page.loading.value" description="Can't read the configuration." />
    </NSpin>

    <template v-else>
      <NAlert v-if="noFlowTable" type="error" title="Critical: the ACL engine has no flow table" class="critical">
        mfwd started without sw_flowd's table of this device's own connections. Their replies no longer pass on
        their own: TCP replies still pass as <code>established</code>, and so does path MTU discovery, but replies
        to DNS and other UDP, and other ICMP such as the replies to its pings, are dropped unless a list permits
        them. This is a broken installation, not a state to
        run in. On the device, start sw_flowd, then restart mfwd (<code>systemctl start sw_flowd</code>,
        <code>systemctl restart mfwd</code>).
      </NAlert>
      <div class="tabbar">
        <div class="tabs" role="tablist" aria-label="Interfaces" @keydown="onTabKey">
          <button
            v-for="n in page.ifaceNames.value"
            :id="`tab-${n}`"
            :key="n"
            type="button"
            role="tab"
            class="tab"
            :aria-selected="page.tab.value === n"
            :tabindex="page.tab.value === n ? 0 : -1"
            @click="page.goTo(n)"
          >
            {{ n }}
            <NTag size="tiny" :type="page.ifaceTag(n).type" :bordered="false">{{ page.ifaceTag(n).label }}</NTag>
          </button>
          <!-- after the interface tabs, as a new-tab "+": it adds one. Arrow keys skip it; Tab reaches it. -->
          <NButton
            dashed
            size="small"
            class="add-iface"
            title="Apply lists to another interface"
            @click="page.openApply({ iface: null, fixed: false })"
          >
            + Another interface
          </NButton>
          <span class="divider" aria-hidden="true"></span>
          <button
            :id="`tab-${page.UNUSED_TAB}`"
            type="button"
            role="tab"
            class="tab"
            :aria-selected="page.tab.value === page.UNUSED_TAB"
            :tabindex="page.tab.value === page.UNUSED_TAB ? 0 : -1"
            @click="page.goTo(page.UNUSED_TAB)"
          >
            Lists not in use
            <span class="badge">{{ unusedCount }}</span>
          </button>
        </div>
      </div>

      <div role="tabpanel" class="panel">
        <UnusedLists v-if="page.tab.value === page.UNUSED_TAB" />
        <InterfacePolicy v-else-if="page.tab.value" :key="page.tab.value" :iface="page.tab.value" />
      </div>
    </template>
  </NCard>

  <template v-if="isAdmin && page.config.value">
    <template v-if="page.dialogs.entry">
      <StdEntryDialog
        v-if="isStandard(page.dialogs.entry.acl)"
        :key="'s' + page.dialogs.entry.acl"
        :req="page.dialogs.entry"
        @close="page.dialogs.entry = null"
      />
      <ExtEntryDialog v-else :key="'e' + page.dialogs.entry.acl" :req="page.dialogs.entry" @close="page.dialogs.entry = null" />
    </template>
    <ApplyListsDialog v-if="page.dialogs.apply" :req="page.dialogs.apply" @close="page.dialogs.apply = null" />
    <NewListDialog v-if="page.dialogs.newList" @close="page.dialogs.newList = false" />
  </template>
</template>

<style scoped>
.tabbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px;
  border-bottom: 1px solid var(--c-border);
  margin-bottom: 16px;
}
.tabs {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 0;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.tab:hover {
  color: var(--c-success-text);
}
.tab[aria-selected='true'] {
  border-bottom-color: var(--c-success);
  color: var(--c-success-text);
  font-weight: 600;
}
.tab:focus-visible {
  outline: 2px solid var(--c-success);
  outline-offset: -2px;
}
.divider {
  width: 1px;
  margin: 8px 6px;
  background: var(--c-border-strong);
}
.badge {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--c-subtle-bg-2);
  font-size: 12px;
  line-height: 18px;
  text-align: center;
}
.add-iface {
  align-self: center;
  margin: 0 4px 0 8px;
}
.critical {
  margin-bottom: 12px;
}
.mock {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--c-muted);
}
</style>
