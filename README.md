# sw-admin-fe

Seawall 管理控制台前端 — Vite + Vue 3 + TypeScript + Naive UI，图表使用 echarts / vue-echarts。

## 开发

```bash
npm install
npm run dev      # http://localhost:5173，/api 代理到 http://127.0.0.1:8080
npm run build    # 类型检查 + 生产构建，输出到 dist/
```

## Mock 数据

由环境变量 `VITE_USE_MOCK` 控制。`.env.development` 里默认为 `true`，`npm run dev` 使用内置 mock（登录账号 `admin / admin`）。

- 本地联调真实后端：新建 `.env.development.local`（已被 git 忽略），写入 `VITE_USE_MOCK=false`。
- 生产构建（`npm run build`）不读取 `.env.development`，mock 关闭，`src/mock.ts` 不会被打包。

## 结构

```
src/
  main.ts          入口
  App.vue          全局 Provider + 布局（侧边栏 / 顶栏 / 内容区）
  router.ts        路由与登录守卫
  auth.ts          登录态（token / 用户名）存取
  types.ts         接口类型定义
  api.ts           fetch 封装与接口函数
  mock.ts          mock 后端（仅开发模式按需加载）
  views/           Login / Dashboard / AclRules / Placeholder
```

## 接口约定（均在 /api 下）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /api/auth/login | `{username, password}` → `{token}` |
| GET | /api/dashboard | 统计卡片、流量趋势、最近拦截事件 |
| GET | /api/acl/rules | 返回全部规则数组（按优先级排序）；搜索、筛选、分页由前端完成 |
| POST | /api/acl/rules | 新增规则 |
| PUT | /api/acl/rules/:id | 更新规则（可部分字段） |
| DELETE | /api/acl/rules/:id | 删除规则 |
| GET | /api/config/pending | `{count}` 未保存的更改数 |
| POST | /api/config/save | 保存配置 |

所有请求带 `Authorization: Bearer <token>`；返回 401 时跳转登录页。错误响应体可带 `{message}` 用于提示。
