import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { ensureSession } from './api'

import './theme.css'
import './theme'

// Check a stored token with the backend before the first navigation, so the router's guard sees a
// stale one already dropped. Done here rather than in the guard: router.ts must not import api.ts.
ensureSession().then(() => createApp(App).use(router).mount('#app'))
