<script setup lang="ts">
// The diagnostic bundle (Seawall proposal 0012 §6): what it holds, so the admin can decide to send it,
// and the button that downloads it. Admins only; the page hides it from users.
import { ref } from 'vue'
import { NAlert, NButton, NCard, NSpace } from 'naive-ui'
import { ApiError, downloadDiag } from '../api'

const busy = ref(false)
/** Why the last download didn't happen, when it's for this card to say. */
const notice = ref<string | null>(null)

async function onDownload() {
  busy.value = true
  notice.value = null
  try {
    await downloadDiag()
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      notice.value =
        'A bundle is already being built; try again shortly. If this keeps happening, the device\'s ' +
        "diagnostic service is failing: run journalctl -u 'seawall-diag@*' on the device."
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <NCard title="Diagnostic Bundle">
    <p class="lead">
      One file for support when something is wrong. It takes a few seconds to a few minutes to build.
      It holds:
    </p>
    <ul>
      <li>the state of the flow table, the software versions and each service's status;</li>
      <li>the data path: attached programs, interfaces, the DDoS gate's and the firewall's state, the latest blocks;</li>
      <li>the configuration, with secrets replaced by ***;</li>
      <li>the logs: everything of the last 24 hours, and warnings of the last 7 days.</li>
    </ul>
    <p>
      It contains clients' IP addresses. Nothing is sent anywhere: you decide whether to send the file.
      Passwords, keys and the licence are never in it. For older logs, run
      <code>sudo /usr/local/seawall/sbin/seawall-diag --since "3 days ago" &gt; diag.tar.gz</code> on the device.
    </p>
    <NSpace vertical>
      <NButton type="primary" :loading="busy" @click="onDownload">
        {{ busy ? 'Building the bundle…' : 'Download Diagnostic Bundle' }}
      </NButton>
      <NAlert v-if="notice" type="warning" :show-icon="false">{{ notice }}</NAlert>
    </NSpace>
  </NCard>
</template>

<style scoped>
.lead {
  margin-top: 0;
}
ul {
  margin: 0 0 12px;
  padding-left: 20px;
}
code {
  font-size: 12px;
}
</style>
