import { createRouter, createWebHistory } from 'vue-router'
import { getToken } from './auth'

const placeholder = () => import('./views/Placeholder.vue')

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./views/Login.vue'), meta: { title: 'Log In', public: true } },
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', component: () => import('./views/Dashboard.vue'), meta: { title: 'Dashboard' } },
    { path: '/acl', component: () => import('./views/AclRules.vue'), meta: { title: 'ACL Rules' } },
    { path: '/ddos', component: placeholder, meta: { title: 'DDoS Protection' } },
    { path: '/http-flood', component: placeholder, meta: { title: 'HTTP Flood' } },
    { path: '/cc', component: placeholder, meta: { title: 'CC Protection' } },
    { path: '/brute-force', component: placeholder, meta: { title: 'Brute-Force Protection' } },
    { path: '/logs', component: placeholder, meta: { title: 'Logs' } },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
  ],
})

router.beforeEach((to) => {
  if (!to.meta.public && !getToken()) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
})

router.afterEach((to) => {
  document.title = `${to.meta.title ?? ''} - Seawall Admin Console`
})

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    public?: boolean
  }
}
