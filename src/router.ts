import { createRouter, createWebHistory } from 'vue-router'
import { getToken } from './api'

const placeholder = () => import('./views/Placeholder.vue')

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./views/Login.vue'), meta: { title: '登录', public: true } },
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', component: () => import('./views/Dashboard.vue'), meta: { title: '仪表盘' } },
    { path: '/acl', component: () => import('./views/AclRules.vue'), meta: { title: 'ACL 规则' } },
    { path: '/ddos', component: placeholder, meta: { title: 'DDoS 防护' } },
    { path: '/http-flood', component: placeholder, meta: { title: 'HTTP Flood' } },
    { path: '/cc', component: placeholder, meta: { title: 'CC 防护' } },
    { path: '/brute-force', component: placeholder, meta: { title: '暴力破解防护' } },
    { path: '/logs', component: placeholder, meta: { title: '日志' } },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
  ],
})

router.beforeEach((to) => {
  if (!to.meta.public && !getToken()) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
})

router.afterEach((to) => {
  document.title = `${to.meta.title ?? ''} - Seawall 管理控制台`
})

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    public?: boolean
  }
}
