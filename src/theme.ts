// Light or dark: the person's choice, kept in this browser, or the system's (the default).
// Naive UI takes the result through NConfigProvider (App.vue) and createDiscreteApi (api.ts); our
// own CSS through data-theme on <html> and the variables in theme.css.

import { computed, ref, watch } from 'vue'

export type ThemeMode = 'system' | 'light' | 'dark'

/** Also read by the script in index.html, before the app loads. */
const KEY = 'sw_theme'

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export const themeMode = ref<ThemeMode>(readMode())

const query = window.matchMedia?.('(prefers-color-scheme: dark)')
const systemDark = ref(query?.matches ?? false)
query?.addEventListener('change', (e) => (systemDark.value = e.matches))

export const isDark = computed(() => themeMode.value === 'dark' || (themeMode.value === 'system' && systemDark.value))

export function setThemeMode(mode: ThemeMode) {
  themeMode.value = mode
  try {
    if (mode === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, mode)
  } catch {
    // private window or blocked storage: it lasts until the page is reloaded
  }
}

watch(isDark, (dark) => (document.documentElement.dataset.theme = dark ? 'dark' : 'light'), { immediate: true })
