# sw-admin-fe

Admin console front end for Seawall — Vite + Vue 3 + TypeScript + Naive UI, charts with echarts / vue-echarts.

## Development

```bash
npm install
SW_DEVICE=https://<device>:8443 npm run dev   # http://localhost:5173, /api proxied to that device
npm run build    # type check + production build, output in dist/
```

## Mock data

Controlled by the environment variable `VITE_USE_MOCK`. `.env.development` sets it to `true`, so `npm run dev` uses the built-in mock (log in as `admin / admin`).

- To work against a real backend: create `.env.development.local` (ignored by git) with `VITE_USE_MOCK=false` and `SW_DEVICE=https://<device>:8443` (or set it on the command line).
- The production build (`npm run build`) doesn't read `.env.development`: the mock is off and `src/mock.ts` is not bundled.

## Layout

```
public/
  llms.txt         user manual for AI assistants, served at /llms.txt
src/
  main.ts          entry point
  App.vue          global providers + layout (sidebar / header / content)
  router.ts        routes and the login guard
  auth.ts          login state (token / user name / role / expiry), kept in sessionStorage
  types.ts         API types
  api.ts           fetch wrapper and endpoint functions
  mock.ts          mock backend (loaded on demand, development only)
  views/           Login / Dashboard / AclRules / Placeholder
```

## User manual for AI assistants

`public/llms.txt` is a plain-text user manual that AI assistants (such as Gemini in Chrome) can read to answer "how do I use this feature" questions. It describes the console as a user sees it, with no implementation details. When a feature or a label in the UI changes, update it there too.

## API contract (all under /api)

| Method | Path | Does |
| --- | --- | --- |
| POST | /api/session | log in: `{user, password}` → `{token, ttl, role}` |
| GET | /api/session | current session: `{user, role, secs_left}` |
| DELETE | /api/session | log out |
| GET | /api/dashboard | stats cards, traffic history, recent blocked events |
| GET | /api/acl/rules | every rule as an array (sorted by priority); search, filters and paging are done in the browser |
| POST | /api/acl/rules | add a rule |
| PUT | /api/acl/rules/:id | update a rule (any subset of fields) |
| DELETE | /api/acl/rules/:id | delete a rule |
| GET | /api/config/pending | `{dirty}`: whether there are unsaved changes |
| POST | /api/config/save | save the configuration |

The full contract is `docs/api.md` in the backend repo lua-resty-sw-admin.

- Every request but the login sends `Authorization: Bearer <token>`. The token is kept in `sessionStorage` (not `localStorage`), runs out `ttl` seconds after login and can't be renewed; the UI warns 1 minute before.
- Error bodies are `{code, error}`: branch on the status and `code`; `error` is only for showing.
- 401: on the login, a wrong user name or password; anywhere else, the session is over and the UI goes to the login page.
- 413 and 429 come from nginx itself as HTML pages, with no JSON body.
