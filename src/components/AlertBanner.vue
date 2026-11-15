<script setup lang="ts">
// The open alerts, at the top of every page (Seawall proposal 0012 §3): the most severe one, and how many
// more. Polled every 10 seconds, in the background, while the tab is visible.
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NAlert } from 'naive-ui'
import { ApiError, fetchOpenAlerts, type Alert } from '../api'
import { conditionLabel, worstAlert } from '../events'
import { usePoller } from '../usePoller'

const POLL_MS = 10_000

const alerts = ref<Alert[]>([])
/** Why the alerts can't be read, or null. */
const failed = ref<string | null>(null)

usePoller(async (background) => {
  try {
    alerts.value = (await fetchOpenAlerts(background)).records
    failed.value = null
  } catch (e) {
    // a 401 is the session's, and the page's own requests deal with it
    if (e instanceof ApiError && e.status === 401) return
    failed.value =
      e instanceof ApiError && e.status === 502
        ? "Alerts can't be read: the event store isn't responding."
        : "Alerts can't be read just now."
  }
}, POLL_MS)

const worst = computed(() => worstAlert(alerts.value))
const others = computed(() => alerts.value.length - 1)
const type = computed(() => (worst.value?.severity === 'critical' ? 'error' : worst.value?.severity === 'warning' ? 'warning' : 'info'))
</script>

<template>
  <NAlert v-if="worst" :type="type" :title="conditionLabel(worst.condition)" class="banner">
    {{ worst.message }}
    <span v-if="others > 0" class="more">
      <RouterLink to="/logs?tab=alerts">and {{ others }} more open alert{{ others === 1 ? '' : 's' }}</RouterLink>
    </span>
  </NAlert>
  <NAlert v-else-if="failed" type="default" class="banner" :show-icon="false">{{ failed }}</NAlert>
</template>

<style scoped>
.banner {
  margin-bottom: 16px;
}
.more {
  margin-left: 8px;
  white-space: nowrap;
}
</style>
