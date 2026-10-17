import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'

const style = document.createElement('style')
style.textContent = 'html, body, #app { margin: 0; height: 100%; }'
document.head.append(style)

createApp(App).use(router).mount('#app')
