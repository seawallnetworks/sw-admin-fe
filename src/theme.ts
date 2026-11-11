// Light or dark: the person's choice, kept in this browser, or the system's (the default).
// Naive UI takes the result through NConfigProvider (App.vue) and createDiscreteApi (api.ts); our
// own CSS through data-theme on <html> and the variables in theme.css.

import { computed, ref, watch } from 'vue'
import { darkTheme, type GlobalThemeOverrides } from 'naive-ui'

export type ThemeMode = 'system' | 'light' | 'dark'

/** Also read by public/theme-init.js, before the app loads. */
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
 * The dark theme, in GitHub's colors (@primer/primitives 11.10, dark.css): Naive UI's dark theme with these
 * overrides. Text-like uses of the primary color (menu, tabs, text buttons) take GitHub's green
 * text color; solid primary buttons are GitHub's green button, with white text. Dialogs, menus
 * and pop-overs are GitHub's overlays (--overlay-bgColor, --shadow-floating-*); the backdrop,
 * which Naive UI doesn't take as a variable, is in theme.css.
 */
const GITHUB_DARK: GlobalThemeOverrides = {
  common: {
    bodyColor: '#0d1117',
    cardColor: '#151b23',
    modalColor: '#010409',
    popoverColor: '#010409',
    tableColor: '#151b23',
    tableHeaderColor: '#151b23',
    tableColorHover: '#1b222c',
    tableColorStriped: '#1b222c',
    inputColor: '#0d1117',
    inputColorDisabled: '#212830',
    actionColor: '#151b23',
    // GitHub's floating shadows: a 1px ring, then depth (menus and pop-overs use boxShadow2)
    boxShadow2: '0 0 0 1px #3d444d, 0 6px 12px -3px #01040966, 0 6px 18px 0 #01040966',
    hoverColor: 'rgba(177, 186, 196, 0.12)',
    pressedColor: 'rgba(177, 186, 196, 0.2)',
    tagColor: '#212830',
    buttonColor2: '#212830',
    buttonColor2Hover: '#262c36',
    buttonColor2Pressed: '#2a313c',
    codeColor: 'rgba(110, 118, 129, 0.4)',
    borderColor: '#3d444d',
    dividerColor: '#3d444d',
    textColorBase: '#f0f6fc',
    textColor1: '#f0f6fc',
    textColor2: '#f0f6fc',
    textColor3: '#9198a1',
    placeholderColor: '#656c76',
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
    // the default button: GitHub's, filled, not Naive's outline that turns green on hover
    color: '#212830',
    colorHover: '#262c36',
    colorPressed: '#2a313c',
    colorFocus: '#262c36',
    border: '1px solid #3d444d',
    borderHover: '1px solid #3d444d',
    borderPressed: '1px solid #3d444d',
    borderFocus: '1px solid #3d444d',
    textColorHover: '#f0f6fc',
    textColorPressed: '#f0f6fc',
    textColorFocus: '#f0f6fc',
    colorPrimary: '#238636',
    colorHoverPrimary: '#29903b',
    colorPressedPrimary: '#2e9a40',
    colorFocusPrimary: '#29903b',
    colorDisabledPrimary: '#105823',
    borderPrimary: '1px solid rgba(240, 246, 252, 0.1)',
    borderHoverPrimary: '1px solid rgba(240, 246, 252, 0.1)',
    borderPressedPrimary: '1px solid rgba(240, 246, 252, 0.1)',
    borderFocusPrimary: '1px solid rgba(240, 246, 252, 0.1)',
    borderDisabledPrimary: '1px solid #105823',
    textColorPrimary: '#ffffff',
    textColorHoverPrimary: '#ffffff',
    textColorPressedPrimary: '#ffffff',
    textColorFocusPrimary: '#ffffff',
    textColorDisabledPrimary: '#ffffff66',
    // GitHub's danger button: a default button with red text, solid red on hover
    colorError: '#212830',
    colorHoverError: '#b62324',
    colorPressedError: '#da3633',
    colorFocusError: '#b62324',
    colorDisabledError: '#212830',
    borderError: '1px solid #3d444d',
    borderHoverError: '1px solid #b62324',
    borderPressedError: '1px solid #da3633',
    borderFocusError: '1px solid #b62324',
    borderDisabledError: '1px solid #3d444d',
    textColorError: '#fa5e55',
    textColorHoverError: '#ffffff',
    textColorPressedError: '#ffffff',
    textColorFocusError: '#ffffff',
    textColorDisabledError: '#f8514980',
  },
  // Radio buttons (Permit/Deny, Any/Host/Network, ...) as GitHub's SegmentedControl: the selected
  // item is a neutral raised segment (--controlKnob-bgColor-rest) with white text and an
  // emphasis border, not a green fill; hover and focus aren't green either. Semibold is in theme.css.
  Radio: {
    buttonColorActive: '#262c36',
    buttonTextColorActive: '#ffffff',
    buttonBorderColorActive: '#656c76',
    buttonBorderColorHover: '#3d444d',
    buttonTextColorHover: '#f0f6fc',
    buttonBoxShadowHover: 'inset 0 0 0 1px #0000',
    buttonBoxShadowFocus: 'inset 0 0 0 1px #1f6feb, 0 0 0 2px #1f6feb4d',
  },
  Tooltip: {
    color: '#3d444d',
    textColor: '#f0f6fc',
  },
}

/** What NConfigProvider takes: :theme and :theme-overrides. */
export const naiveTheme = computed(() =>
  isDark.value ? { theme: darkTheme, themeOverrides: GITHUB_DARK } : { theme: null, themeOverrides: null },
)
