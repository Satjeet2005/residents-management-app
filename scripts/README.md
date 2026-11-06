# scripts

Developer and CI scripts (e.g. `scan-secrets.mjs`). No application logic.

- `smoke-auth.mjs`: checks login, `/api/me`, logout-all and the cookie over real HTTP against a running server. `npm run smoke:auth -- <BASE_URL> <demo phone>`. Needs the server in demo mode; prints lengths, never the code, token or cookie.
