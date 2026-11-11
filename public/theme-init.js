// The theme before the app loads, so a dark page doesn't flash white; src/theme.ts keeps it after.
// A file, not inline in index.html: the console's Content-Security-Policy allows scripts only
// from its own origin. Kept in step with src/theme.ts (the key and its values).
try {
  var m = localStorage.getItem('sw_theme')
  var dark = m === 'dark' || (m !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
} catch (e) {}
