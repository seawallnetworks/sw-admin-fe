// Light or dark: the person's choice, kept in this browser, or the system's (the default).
// Naive UI takes the result through NConfigProvider (App.vue) and createDiscreteApi (api.ts); our
// own CSS through data-theme on <html> and the variables in theme.css.

import { computed, ref, watch } from 'vue'
import { darkTheme, type GlobalThemeOverrides } from 'naive-ui'

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

/**
 * The dark theme, in GitHub's colors (Primer "Dark default"): Naive UI's dark theme with these
 * overrides. Text-like uses of the primary color (menu, tabs, text buttons) take GitHub's green
 * text color; solid primary buttons are GitHub's green button, with white text.
 */
const GITHUB_DARK: GlobalThemeOverrides = {
  common: {
    bodyColor: '#0d1117',
    cardColor: '#161b22',
    modalColor: '#161b22',
    popoverColor: '#161b22',
    tableColor: '#161b22',
    tableHeaderColor: '#161b22',
    tableColorHover: '#1c2128',
    tableColorStriped: '#1c2128',
    inputColor: '#0d1117',
    inputColorDisabled: '#161b22',
    actionColor: '#161b22',
    hoverColor: 'rgba(177, 186, 196, 0.12)',
    pressedColor: 'rgba(177, 186, 196, 0.2)',
    tagColor: '#21262d',
    buttonColor2: '#21262d',
    buttonColor2Hover: '#30363d',
    buttonColor2Pressed: '#282e33',
    codeColor: 'rgba(110, 118, 129, 0.4)',
    borderColor: '#30363d',
    dividerColor: '#30363d',
    textColorBase: '#e6edf3',
    textColor1: '#e6edf3',
    textColor2: '#e6edf3',
    textColor3: '#9198a1',
    placeholderColor: '#6e7681',
    iconColor: '#9198a1',
    primaryColor: '#3fb950',
    primaryColorHover: '#56d364',
    primaryColorPressed: '#2ea043',
    primaryColorSuppl: '#56d364',
    infoColor: '#4493f8',
    infoColorHover: '#58a6ff',
    infoColorPressed: '#1f6feb',
    infoColorSuppl: '#58a6ff',
    successColor: '#3fb950',
    successColorHover: '#56d364',
    successColorPressed: '#2ea043',
    successColorSuppl: '#56d364',
    warningColor: '#d29922',
    warningColorHover: '#e3b341',
    warningColorPressed: '#bb8009',
    warningColorSuppl: '#e3b341',
    errorColor: '#f85149',
    errorColorHover: '#ff7b72',
    errorColorPressed: '#da3633',
    errorColorSuppl: '#ff7b72',
  },
  Button: {
    colorPrimary: '#238636',
    colorHoverPrimary: '#2ea043',
    colorPressedPrimary: '#238636',
    colorFocusPrimary: '#2ea043',
    colorDisabledPrimary: '#238636',
    borderPrimary: '1px solid rgba(240, 246, 252, 0.1)',
    borderHoverPrimary: '1px solid rgba(240, 246, 252, 0.1)',
    borderPressedPrimary: '1px solid rgba(240, 246, 252, 0.1)',
    borderFocusPrimary: '1px solid rgba(240, 246, 252, 0.1)',
    borderDisabledPrimary: '1px solid rgba(240, 246, 252, 0.1)',
    textColorPrimary: '#ffffff',
    textColorHoverPrimary: '#ffffff',
    textColorPressedPrimary: '#ffffff',
    textColorFocusPrimary: '#ffffff',
    textColorDisabledPrimary: 'rgba(255, 255, 255, 0.5)',
  },
}

/** What NConfigProvider takes: :theme and :theme-overrides. */
export const naiveTheme = computed(() =>
  isDark.value ? { theme: darkTheme, themeOverrides: GITHUB_DARK } : { theme: null, themeOverrides: null },
)
