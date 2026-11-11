// The Access Lists page's shared state: the configuration, the engine's state, the open dialog,
// and the changes every part of the page makes. AccessLists.vue creates it and provides it; the
// components under it take it with useAclPage().

import { computed, h, inject, onMounted, onUnmounted, provide, reactive, ref, type InjectionKey } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NSpace, useDialog, useMessage } from 'naive-ui'
import {
  bindAcl, deleteAcl, deleteAclEntry, getAclEngine, getConfig, refreshPendingChanges, unbindAcl,
  type AclEngine, type AclEntry, type DeviceConfig,
} from './api'
import { parseAceRule } from './ace'
import { interfacesUsing, isStandard, permitsTcpPort } from './policy'

export type Config = DeviceConfig['config']

/**
 * The TCP port this console is reached on: what an extended list must permit to keep it.
 * TODO(backend): the console's client address and the interface it arrives on aren't in the API;
 * with them the page could check the lists against this very connection.
 */
export const CONSOLE_PORT = Number(location.port) || (location.protocol === 'https:' ? 443 : 80)

// ---------- an interface's status ----------

export type IfaceStatus = 'enforced' | 'applying' | 'down' | 'refused' | 'off' | 'missing' | 'unfiltered' | 'unknown'

export const STATUS_LABEL: Record<IfaceStatus, string> = {
  enforced: 'Enforced',
  applying: 'Applying',
  down: 'Engine down',
  refused: 'Refused',
  off: 'Off',
  missing: 'Not on this device',
  unfiltered: 'Not filtered',
  unknown: 'Checking…',
}
export const STATUS_TYPE: Record<IfaceStatus, 'success' | 'info' | 'error' | 'default' | 'warning'> = {
  enforced: 'success',
  applying: 'info',
  down: 'error',
  refused: 'error',
  off: 'default',
  missing: 'warning',
  unfiltered: 'default',
  unknown: 'default',
}

/** Whether a verdict is what the device does now (enforced), may be (applying...), or isn't (not filtered). */
export function statusCertainty(s: IfaceStatus): 'now' | 'maybe' | 'not' {
  if (s === 'enforced') return 'now'
  if (s === 'applying' || s === 'refused' || s === 'down' || s === 'unknown') return 'maybe'
  return 'not'
}

// ---------- dialogs ----------

/** A stage in the Apply dialog: no list, an existing list, or a new one. */
export type StageChoice = number | 'none' | 'new'

export interface EntryRequest {
  acl: number
  /** The interface the dialog was opened from, for the title; null from Lists not in use. */
  iface: string | null
  /** A positionOptions() key; the dialog's default when absent. */
  pos?: string
}

export interface ApplyRequest {
  iface: string | null
  /** The interface can't be changed (opened from its tab). */
  fixed: boolean
  std?: StageChoice
  ext?: StageChoice
}

// ---------- the store ----------

const POLL_MS = 5000

function createAclPage() {
  const message = useMessage()
  const dialog = useDialog()
  const route = useRoute()
  const router = useRouter()

  const config = ref<Config | null>(null)
  /** The configuration's generation when it was read; it moves with every change, from anyone. */
  const generation = ref<number | null>(null)
  const loading = ref(false)

  async function loadConfig() {
    loading.value = true
    try {
      const res = await getConfig()
      config.value = res.config
      generation.value = res.generation ?? null
    } catch {
      // error already shown by api.ts
    } finally {
      loading.value = false
    }
  }

  // ---------- the engine: polled every 5 s, paused while the browser tab is hidden ----------

  const engine = ref<AclEngine | null>(null)
  const engineError = ref<string | null>(null)
  let timer: number | undefined
  let inFlight = false
  let stopped = false
  let firstPoll = true

  async function pollEngine() {
    window.clearTimeout(timer)
    timer = undefined
    if (inFlight) return
    inFlight = true
    try {
      // only the first call toasts its error; after that the status line says it
      engine.value = await getAclEngine(!firstPoll)
      engineError.value = null
    } catch (e) {
      engineError.value = e instanceof Error ? e.message : String(e)
    } finally {
      inFlight = false
      firstPoll = false
    }
    if (!document.hidden && !stopped) timer = window.setTimeout(pollEngine, POLL_MS)
  }
  function onVisibilityChange() {
    if (document.hidden) {
      window.clearTimeout(timer)
      timer = undefined
    } else {
      pollEngine()
    }
  }

  /** Starts loading and polling; for the page's setup. */
  function start() {
    onMounted(() => {
      document.addEventListener('visibilitychange', onVisibilityChange)
      loadConfig()
      pollEngine()
    })
    onUnmounted(() => {
      stopped = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    })
  }

  // ---------- reading the configuration ----------

  const ifaceNames = computed(() => Object.keys(config.value?.interfaces ?? {}))
  const aclNumbers = computed(() => Object.keys(config.value?.acls ?? {}).map(Number).sort((a, b) => a - b))
  const entriesOf = (acl: number): AclEntry[] => config.value?.acls[acl] ?? []
  const appliedOn = (acl: number) => (config.value ? interfacesUsing(config.value, acl) : [])
  /** The other interfaces that apply a list. */
  const alsoOn = (acl: number, iface: string | null) => appliedOn(acl).filter((n) => n !== iface)

  function ifaceStatus(name: string): IfaceStatus {
    const e = engine.value
    if (!e) return 'unknown'
    if (e.missing?.includes(name)) return 'missing'
    if (!config.value?.interfaces[name]?.acls_in.length) return 'unfiltered'
    switch (e.state) {
      case 'off':
        return 'off'
      case 'unreachable':
        return 'down'
      case 'refused':
        return 'refused'
      case 'pending':
        return 'applying'
      case 'applied':
        // without `live` there's no `attached` to go by: the engine says it applied the lists
        return !e.live || e.attached?.includes(name) ? 'enforced' : 'unfiltered'
    }
  }

  /** The tab's tag: Filtered, Not on this device, or Not filtered. */
  function ifaceTag(name: string): { label: string; type: 'success' | 'warning' | 'default' } {
    const e = engine.value
    if (e?.missing?.includes(name)) return { label: 'Not on this device', type: 'warning' }
    // pending too: the tag shouldn't flicker to "Not filtered" for the few seconds after each change
    if ((e?.state === 'applied' || e?.state === 'pending') && e.attached?.includes(name)) {
      return { label: 'Filtered', type: 'success' }
    }
    return { label: 'Not filtered', type: 'default' }
  }

  /** Lists no interface uses, and lists used only on interfaces that aren't on the device. */
  const unused = computed(() => {
    const missing = engine.value?.missing ?? []
    const notApplied: number[] = []
    const onlyMissing: number[] = []
    for (const acl of aclNumbers.value) {
      const on = appliedOn(acl)
      if (!on.length) notApplied.push(acl)
      else if (on.every((n) => missing.includes(n))) onlyMissing.push(acl)
    }
    return { notApplied, onlyMissing }
  })

  // ---------- changes ----------

  /**
   * Runs one change, then reads the configuration again (the device rewrites entries in its own
   * form) and asks again about unsaved changes. A refused change throws, its message shown by api.ts.
   */
  async function mutate(fn: () => Promise<unknown>, okText: string | null) {
    await fn()
    if (okText) message.success(okText)
    refreshPendingChanges().catch(() => {})
    pollEngine()
    await loadConfig()
  }

  /** After several calls made without mutate(): read everything again. */
  async function refreshAfterChanges() {
    refreshPendingChanges().catch(() => {})
    pollEngine()
    await loadConfig()
  }

  /**
   * Whether the configuration is still the one shown. If someone else changed it (another admin, or
   * the CLI), the page shows the new one and says so, and the caller stops: an entry is deleted by
   * its seq, which may now be another entry.
   */
  async function stillCurrent(): Promise<boolean> {
    const shown = generation.value
    let res: DeviceConfig
    try {
      res = await getConfig()
    } catch {
      return false // error already shown by api.ts
    }
    if (shown === null || res.generation === undefined || res.generation === shown) return true
    config.value = res.config
    generation.value = res.generation ?? null
    message.warning('The access lists were changed elsewhere since you opened them. Check the list, then try again.', {
      duration: 8000,
    })
    return false
  }

  async function deleteEntry(acl: number, seq: number) {
    if (!(await stillCurrent())) return
    await mutate(() => deleteAclEntry(acl, seq), `Entry ${seq} deleted from list ${acl}`).catch(() => {})
  }

  /** What deleting an entry does, for the row under it; `iface` is the tab it is shown on. */
  function deleteExplanation(acl: number, e: AclEntry, iface: string | null): string {
    const r = parseAceRule(e.ace, isStandard(acl))
    const on = appliedOn(acl)
    const parts: string[] = []
    if (!on.length) {
      parts.push(`List ${acl} isn't applied to any interface, so traffic isn't affected.`)
    } else if (isStandard(acl)) {
      parts.push(
        r?.action === 'permit'
          ? 'These sources meet the deny entries after it again.'
          : 'The sources it drops go on to stage 2 instead.',
      )
    } else if (r?.action === 'permit') {
      const enforced = on.filter((n) => ifaceStatus(n) === 'enforced')
      parts.push(
        enforced.length
          ? `List ${acl} is enforced on ${enforced.join(', ')}: the traffic this entry lets in will fall to the ` +
              'implicit deny, unless an entry after it permits it.'
          : 'The traffic this entry lets in will fall to the implicit deny, unless an entry after it permits it.',
      )
      const rest = entriesOf(acl).filter((x) => x.seq !== e.seq)
      if (permitsTcpPort([e], CONSOLE_PORT) && !permitsTcpPort(rest, CONSOLE_PORT)) {
        parts.push(`It is the list's last permit for TCP port ${CONSOLE_PORT}: this console may be cut off.`)
      }
    } else {
      parts.push('The traffic it drops goes on to the entries after it.')
    }
    const also = alsoOn(acl, iface)
    if (on.length && also.length) parts.push(sharedNote(also))
    return parts.join(' ')
  }

  /** The two-step delete on a whole list. Lists used only on missing interfaces are removed there first. */
  async function deleteList(acl: number) {
    const on = appliedOn(acl)
    try {
      for (const n of on) await unbindAcl(n, acl)
      await mutate(() => deleteAcl(acl), `Access list ${acl} deleted`)
    } catch {
      if (on.length) await refreshAfterChanges()
    }
  }

  /**
   * "Remove from <iface>": only unbinds. If no interface uses the list afterwards, the same confirm
   * asks whether to delete it too.
   */
  function removeFromIface(iface: string, acl: number) {
    const lastUse = appliedOn(acl).length === 1
    const effect = isStandard(acl)
      ? `${iface} stops dropping the sources list ${acl} denies.`
      : `${iface} stops filtering by list ${acl}: everything that gets past stage 1 passes.`
    const unbind = () => mutate(() => unbindAcl(iface, acl), `${iface} no longer applies list ${acl}`)
    if (!lastUse) {
      dialog.info({
        title: `Remove list ${acl} from ${iface}`,
        content: `${effect} The list stays applied on ${alsoOn(acl, iface).join(', ')}.`,
        positiveText: 'Remove',
        negativeText: 'Cancel',
        onPositiveClick: () => unbind().catch(() => {}),
      })
      return
    }
    const d = dialog.info({
      title: `Remove list ${acl} from ${iface}`,
      content: () =>
        h('div', [
          h('p', { style: 'margin: 0 0 8px' }, effect),
          h('p', { style: 'margin: 0' }, `List ${acl} is no longer used anywhere. Delete it too?`),
        ]),
      action: () =>
        h(NSpace, { justify: 'end' }, () => [
          h(NButton, { onClick: () => d.destroy() }, () => 'Cancel'),
          h(NButton, {
            onClick: () => {
              d.destroy()
              unbind()
                .then(() => message.info(`List ${acl} kept; it is under Lists not in use`))
                .catch(() => {})
            },
          }, () => 'Keep it'),
          h(NButton, {
            type: 'error',
            onClick: async () => {
              d.destroy()
              try {
                await unbindAcl(iface, acl)
                await mutate(() => deleteAcl(acl), `${iface} no longer applies list ${acl}; list ${acl} deleted`)
              } catch {
                await refreshAfterChanges()
              }
            },
          }, () => 'Delete list'),
        ]),
    })
  }

  /** Binds and unbinds to give `iface` these lists; makes no call for a stage that stays. */
  async function setLists(iface: string, std: number | null, ext: number | null) {
    const cur = config.value?.interfaces[iface]?.acls_in ?? []
    const curStd = cur.find(isStandard) ?? null
    const curExt = cur.find((a) => !isStandard(a)) ?? null
    if (std !== curStd) await (std === null ? unbindAcl(iface, curStd!) : bindAcl(iface, std))
    if (ext !== curExt) await (ext === null ? unbindAcl(iface, curExt!) : bindAcl(iface, ext))
  }

  // ---------- tabs, in the URL ----------

  const UNUSED_TAB = 'unused'
  /** The selected tab: an interface name, or UNUSED_TAB. */
  const tab = computed<string | null>(() => {
    if (route.query.tab === UNUSED_TAB) return UNUSED_TAB
    const q = typeof route.query.iface === 'string' ? route.query.iface : null
    if (q && ifaceNames.value.includes(q)) return q
    return ifaceNames.value[0] ?? (config.value ? UNUSED_TAB : null)
  })
  function goTo(t: string) {
    router.replace({ query: t === UNUSED_TAB ? { tab: UNUSED_TAB } : { iface: t } })
  }

  // ---------- dialogs: one open at a time ----------

  const dialogs = reactive({
    entry: null as EntryRequest | null,
    apply: null as ApplyRequest | null,
    newList: false,
  })
  const openAddEntry = (req: EntryRequest) => (dialogs.entry = req)
  const openApply = (req: ApplyRequest) => (dialogs.apply = req)
  const openNewList = () => (dialogs.newList = true)

  return {
    config, generation, loading, engine, engineError, start, loadConfig, pollEngine,
    ifaceNames, aclNumbers, entriesOf, appliedOn, alsoOn, ifaceStatus, ifaceTag, unused,
    mutate, refreshAfterChanges, stillCurrent, deleteEntry, deleteExplanation, deleteList, removeFromIface, setLists,
    UNUSED_TAB, tab, goTo,
    dialogs, openAddEntry, openApply, openNewList,
    message, dialog,
  }
}

export type AclPage = ReturnType<typeof createAclPage>
const KEY: InjectionKey<AclPage> = Symbol('aclPage')

export function provideAclPage(): AclPage {
  const page = createAclPage()
  provide(KEY, page)
  return page
}

export function useAclPage(): AclPage {
  const page = inject(KEY)
  if (!page) throw new Error('useAclPage() outside the Access Lists page')
  return page
}

/** "Also applied on eth1; changes apply there too." */
export const sharedNote = (also: string[]) => `Also applied on ${also.join(', ')}; changes apply there too.`

/** "If you manage this device through eth0, this cuts off the console." For a list that doesn't permit it. */
export function consoleWarning(ifaces: string[]): string {
  const where = ifaces.length ? ifaces.join(' or ') : 'the interface it is applied to'
  return (
    `This list doesn't permit TCP port ${CONSOLE_PORT}, the port of this console. If you manage this device ` +
    `through ${where}, this cuts off the console.`
  )
}
