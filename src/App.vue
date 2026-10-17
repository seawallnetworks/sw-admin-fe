<script setup lang="ts">
import { computed, h, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import {
  NButton, NConfigProvider, NDialogProvider, NDropdown, NLayout, NLayoutContent, NLayoutHeader, NLayoutSider,
  NMenu, NMessageProvider, NSpace, NTag, dateZhCN, zhCN, type MenuOption,
} from 'naive-ui'
import { getToken, getUsername, logout, pendingChanges, refreshPendingChanges, saveConfig } from './api'

const route = useRoute()
const isPublic = computed(() => route.meta.public)

const menuItems: [string, string][] = [
  ['/dashboard', '仪表盘'],
  ['/acl', 'ACL 规则'],
  ['/ddos', 'DDoS 防护'],
  ['/http-flood', 'HTTP Flood'],
  ['/cc', 'CC 防护'],
  ['/brute-force', '暴力破解防护'],
  ['/logs', '日志'],
]
const menuOptions: MenuOption[] = menuItems.map(([path, label]) => ({
  key: path,
  label: () => h(RouterLink, { to: path }, () => label),
}))

const collapsed = ref(false)
const username = ref(getUsername())

// Refresh header state whenever we land on an authenticated page (e.g. right after login).
watch(
  () => route.path,
  () => {
    if (isPublic.value || !getToken()) return
    username.value = getUsername()
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

const userOptions = [{ key: 'logout', label: '退出登录' }]
function onUserSelect(key: string) {
  if (key === 'logout') logout()
}
</script>

<template>
  <NConfigProvider :locale="zhCN" :date-locale="dateZhCN">
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
            <div class="brand">{{ collapsed ? 'SW' : 'Seawall 控制台' }}</div>
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
                <NTag v-if="pendingChanges > 0" type="warning" round>{{ pendingChanges }} 项未保存的更改</NTag>
                <NButton type="primary" :disabled="pendingChanges === 0" :loading="saving" @click="onSave">
                  保存配置
                </NButton>
                <NDropdown :options="userOptions" trigger="click" @select="onUserSelect">
                  <NButton quaternary>{{ username || '用户' }} ▾</NButton>
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
