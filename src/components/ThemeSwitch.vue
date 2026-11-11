<script setup lang="ts">
// The theme switch in the header: an icon for the current choice, and a menu of System, Light
// and Dark. The choice is kept in this browser (src/theme.ts).
import { computed, h, type Component } from 'vue'
import { NButton, NDropdown, NIcon, type DropdownOption } from 'naive-ui'
import { MoonIcon, SunIcon, SystemThemeIcon } from '../icons'
import { setThemeMode, themeMode, type ThemeMode } from '../theme'

const THEMES: { mode: ThemeMode; label: string; icon: Component }[] = [
  { mode: 'system', label: 'System', icon: SystemThemeIcon },
  { mode: 'light', label: 'Light', icon: SunIcon },
  { mode: 'dark', label: 'Dark', icon: MoonIcon },
]

const current = computed(() => THEMES.find((t) => t.mode === themeMode.value) ?? THEMES[0])

const options = computed<DropdownOption[]>(() =>
  THEMES.map((t) => ({
    key: t.mode,
    // the current one is checked
    label: `${t.label}${t.mode === themeMode.value ? '  ✓' : ''}`,
    icon: () => h(NIcon, null, { default: () => h(t.icon) }),
  })),
)
</script>

<template>
  <NDropdown :options="options" trigger="click" @select="(m: ThemeMode) => setThemeMode(m)">
    <NButton quaternary circle :aria-label="`Theme: ${current.label}`" :title="`Theme: ${current.label}`">
      <template #icon>
        <NIcon :size="18"><component :is="current.icon" /></NIcon>
      </template>
    </NButton>
  </NDropdown>
</template>
