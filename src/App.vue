<script setup lang="ts">
import { computed, h, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import {
  NButton, NConfigProvider, NDialogProvider, NDropdown, NLayout, NLayoutContent, NLayoutHeader, NLayoutSider,
  NMenu, NMessageProvider, NSpace, NTag, NTooltip, dateEnUS, enUS, type MenuOption,
} from 'naive-ui'
import HelpDrawer from './components/HelpDrawer.vue'
import { getRole, getToken, getUsername, logout, refreshPendingChanges, saveConfig, unsavedChanges } from './api'

const route = useRoute()
const isPublic = computed(() => route.meta.public)

const menuItems: [string, string][] = [
  ['/dashboard', 'Dashboard'],
  ['/acl', 'ACL Rules'],
  ['/ddos', 'DDoS Protection'],
  ['/http-flood', 'HTTP Flood'],
  ['/cc', 'CC Protection'],
  ['/brute-force', 'Brute-Force Protection'],
  ['/logs', 'Logs'],
]
const menuOptions: MenuOption[] = menuItems.map(([path, label]) => ({
  key: path,
  label: () => h(RouterLink, { to: path }, () => label),
}))

const collapsed = ref(false)
const username = ref(getUsername())
const isAdmin = ref(getRole() === 'admin')

// Refresh header state whenever we land on an authenticated page (e.g. right after login).
watch(
  () => route.path,
  () => {
    if (isPublic.value || !getToken()) return
    username.value = getUsername()
    isAdmin.value = getRole() === 'admin'
    refreshPendingChanges().catch(() => {})
  },
  { immediate: true },
)

const saving = ref(false)
async function onSave() {
  saving.value = true
  try {
    await saveConfig()
  } finally {
    saving.value = false
  }
}

const userOptions = [{ key: 'logout', label: 'Log out' }]
function onUserSelect(key: string) {
  if (key === 'logout') logout()
}
</script>

<template>
  <NConfigProvider :locale="enUS" :date-locale="dateEnUS">
    <NMessageProvider>
      <NDialogProvider>
        <RouterView v-if="isPublic" />
        <NLayout v-else has-sider class="shell">
          <NLayoutSider
            bordered
            collapse-mode="width"
            :collapsed-width="64"
            :width="200"
            :collapsed="collapsed"
            show-trigger
            @collapse="collapsed = true"
            @expand="collapsed = false"
          >
            <div class="brand">{{ collapsed ? 'SW' : 'Seawall Console' }}</div>
            <NMenu
              :options="menuOptions"
              :value="route.path"
              :collapsed="collapsed"
              :collapsed-width="64"
            />
          </NLayoutSider>
          <NLayout>
            <NLayoutHeader bordered class="header">
              <span class="title">{{ route.meta.title }}</span>
              <NSpace align="center">
                <NTooltip v-if="isAdmin && unsavedChanges">
                  <template #trigger>
                    <NTag type="warning" round>Unsaved changes</NTag>
                  </template>
                  Changes are in effect now, but a restart loses them until you click Save Config.
                </NTooltip>
                <NButton v-if="isAdmin" type="primary" :disabled="!unsavedChanges" :loading="saving" @click="onSave">
                  Save Config
                </NButton>
                <HelpDrawer />
                <NDropdown :options="userOptions" trigger="click" @select="onUserSelect">
                  <NButton quaternary>{{ username || 'User' }} ▾</NButton>
                </NDropdown>
              </NSpace>
            </NLayoutHeader>
            <NLayoutContent content-style="padding: 20px;" class="content">
              <RouterView />
            </NLayoutContent>
          </NLayout>
        </NLayout>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

<style scoped>
.shell {
  height: 100vh;
}
.brand {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 16px;
  white-space: nowrap;
  overflow: hidden;
}
.header {
  height: 56px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.title {
  font-size: 16px;
  font-weight: 500;
}
.content {
  height: calc(100vh - 56px);
  background: #f5f7fa;
}
</style>
