# sw-admin-fe

Admin console front end for Seawall — Vite + Vue 3 + TypeScript + Naive UI, charts with echarts / vue-echarts.

## Development

```bash
npm install
SW_DEVICE=https://<device>:8443 npm run dev   # http://localhost:5173, /api proxied to that device
npm run build    # type check + production build, output in dist/
```

## Deploy

```bash
tools/deploy.sh    # build and install on this machine
```

It builds, refuses a build that contains the mock, copies `dist/` into `/usr/local/seawall/share/sw_admin` (where sw_admin's nginx serves it; sudo if that isn't writable), and then checks that `https://localhost:8443/` serves the new `index.html` and that `/llms.txt` refuses a request without a login. nginx doesn't need a restart.

New assets go in before the new `index.html`, and the old ones are removed last. A tab opened before the deploy that then opens a page whose code is gone reloads once, with the new build.

## Mock data

Controlled by the environment variable `VITE_USE_MOCK`. `.env.development` sets it to `true`, so `npm run dev` uses the built-in mock (log in as `admin / admin`).

- To work against a real backend: create `.env.development.local` (ignored by git) with `VITE_USE_MOCK=false` and `SW_DEVICE=https://<device>:8443` (or set it on the command line).
- The production build (`npm run build`) doesn't read `.env.development`: the mock is off and `src/mock.ts` is not bundled.

## Layout

```
tools/
  deploy.sh        build and install on this machine
public/
  llms.txt         user manual for AI assistants, served at /llms.txt to logged-in users
src/
  main.ts          entry point
  App.vue          global providers + layout (sidebar / header / content)
  router.ts        routes and the login guard
  auth.ts          login state (token / user name / role / expiry), kept in sessionStorage
  types.ts         API types
  api.ts           fetch wrapper, endpoint functions, and the session's timers
  usePoller.ts     polling for a page; its requests are background ones
  help.ts          loads public/llms.txt and splits it into sections for the help drawer
  mock.ts          mock backend (loaded on demand, development only);
                   mockSession(idle, limit) in the console shortens the session
  components/      HelpDrawer (the Help button and its panel)
  views/           Login / Dashboard / AclRules / Placeholder
```

## User manual for AI assistants

`public/llms.txt` is a plain-text user manual that AI assistants (such as Gemini in Chrome) can read to answer "how do I use this feature" questions. It describes the console as a user sees it, with no implementation details. When a feature or a label in the UI changes, update it there too.

nginx gives `/llms.txt` to logged-in users only (see `conf/nginx.conf` in lua-resty-sw-admin), so the console fetches it with the session's token, and a plain link to it gets a 401. The console's Help button shows the same file, a few sections at a time, or all of it with "Full manual": each route's `meta.help` in `src/router.ts` names the `## ` headings to show. AI assistants in the browser read the page, not `/llms.txt`, so the panel is what puts the manual in front of them. Keep those headings in step with `meta.help` when renaming one.

## API contract (all under /api)

| Method | Path | Does |
| --- | --- | --- |
| POST | /api/session | log in: `{user, password}` → `{token, ttl, role, idle}` |
| GET | /api/session | current session: `{user, role, secs_left}`; extends it, unless background |
| DELETE | /api/session | log out |
| GET | /api/dashboard | stats cards, traffic history, recent blocked events |
| GET | /api/acl/rules | every rule as an array (sorted by priority); search, filters and paging are done in the browser |
| POST | /api/acl/rules | add a rule |
| PUT | /api/acl/rules/:id | update a rule (any subset of fields) |
| DELETE | /api/acl/rules/:id | delete a rule |
| GET | /api/config/pending | `{dirty}`: whether there are unsaved changes |
| POST | /api/config/save | save the configuration |

The full contract is `docs/api.md` in the backend repo lua-resty-sw-admin.

- Every request but the login sends `Authorization: Bearer <token>`. The token is kept in `sessionStorage` (not `localStorage`). It runs out after `idle` seconds without activity, and at a time limit (12 hours by default) however active the user is (proposal 0014).
- Every request counts as activity, except one sent with `X-SW-Background: 1`. Polls must be background ones: they go through `usePoller()`, and `src/timers.test.ts` fails on a timer anywhere else but `api.ts`. Keys, clicks, the wheel and focus in the page count too; `api.ts` sends them as a `GET /api/session` at most once a minute.
- Replies carry the token's seconds left in `X-SW-Session-Left`, which moves the session's timers. A minute before the end the UI asks the backend again, then shows a dialog: "Stay signed in" for the idle timeout, or a notice that the time limit can't be pushed back.
- Error bodies are `{code, error}`: branch on the status and `code`; `error` is only for showing.
- 401: on the login, a wrong user name or password; anywhere else, the session is over and the UI goes to the login page.
- 413 and 429 come from nginx itself as HTML pages, with no JSON body.
