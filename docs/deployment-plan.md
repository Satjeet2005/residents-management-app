# Deployment plan: Vercel (Hobby) and Neon (Free)

Status: research and plan only. Nothing has been deployed, no account was created, and no command was run
against Vercel or Neon. Written 2026-11-06.

This document answers one question: can we keep a live URL up for at least 40 days, with no cost and no card,
without weakening the money and security rules of this project? Every fact below was read from the vendor's
documentation in the session that wrote this file, on 2026-11-06. Where a page did not say something, the table
says **not found**. Where two sources disagree, both are given.

How to read the facts: the quoted wording comes from the page text as the fetch tool returned it. The fetch tool
summarises long pages with a small model, so a quote can be trimmed. Before you rely on a fact that decides money,
cost or data loss, open the source and read the sentence. Several Neon pages also contained text addressed to AI
assistants (install an agent skill, post feedback to a URL). It was not followed.

## Decisions for the human

Nothing here needs a paid plan or a card unless it says so. Each decision has options, a recommendation, and what
each option costs. **All 12 were accepted by the human (D93)**, as recommended unless a later decision says otherwise
(D89 to D92, D94 and D95 record the outcomes in `docs/decisions.md`).
(`D85` was named in the brief but does not exist: the decision log ends at D83. `npm run smoke:auth` did not exist when
this plan was written; it was added in T8c, see "Post-deploy smoke test".)

| # | Decision | Options | Recommendation | Cost of each option |
|---|---|---|---|---|
| 1 | **Is Hobby allowed for this project?** Vercel forbids commercial use on Hobby, defined as any deployment "used for the purpose of financial gain of anyone involved in any part of the production of the project, including a paid employee or consultant writing the code" (V1e). | A. Deploy on Hobby. B. Do not deploy (Pro needs a card and money). | **A, but only if you judge this take-home to be unpaid personal work.** I cannot decide this for you, and I am not giving a legal reading. If anyone is paid for this work, Hobby does not allow it. | A: free, with the risk that Vercel shuts the project down "without notice" (V7b) if it disagrees. B: no live URL. |
| 2 | **Region** (Neon cannot move later, N13b). | A. Neon **Singapore** (`aws-ap-southeast-1`) with Vercel functions in **`sin1`** (the same AWS region). B. Neon Singapore with Vercel `bom1` (Mumbai). C. Neon Sydney. | **A.** Mumbai has no Neon region (N13a), and putting the function next to the database avoids a cross-region round trip on every one of the many queries in a request. I did not measure latency. | All free. B adds a hop between function and database; C is farther from India. Changing the Neon region later means a new project and a re-seed (minutes, since the data is generated). |
| 3 | **Daily jobs: Vercel cron, or after-response jobs plus a button?** (D10 says both.) | A. Vercel cron once a day **plus** after-response work **plus** a staff "run daily jobs now" button. B. After-response work and the button only. C. An outside scheduler. | **A.** Cron on Hobby is once a day, runs any time in the hour, is best effort, can repeat or be skipped (V6). So every job must be safe to run twice, and the button covers a missed run. C needs another account, so no. | A and B: free. The cron route and the processor are not built yet. |
| 4 | **Preview deployments** | A. On, but with **no database variables in Preview**, so a preview cannot reach any database. B. On, with a separate Neon branch for previews, set by hand. C. Use the Neon-Vercel integration's branch-per-preview. D. Avoid previews by pushing only the production branch. | **A**, with D as the habit. C injects the owner's credentials (N16) and copies data; B works but is more setup. | A, D: free. B, C: use Neon branches (10 allowed on Free, N9a) and storage. |
| 5 | **App database role: what UPDATE does it get?** | A. **Column-level** UPDATE only on the columns the code writes (sessions and one-time codes now; others when their feature ships). B. Table-level UPDATE on the mutable tables. C. UPDATE on every table except the append-only ones. | **A.** Sessions and one-time codes are what an attacker would want to edit (`expires_at`, `user_id`). The five append-only tables get only SELECT and INSERT in every option. | Free. A needs one grant line per new feature, and a test that fails when the grants and the code disagree (a later task). |
| 6 | **How long must it stay alive, and should Neon be kept awake?** | A. Plan for **60 days** and do **not** keep Neon awake; let the daily cron wake it. B. Keep it awake with frequent pings. | **A.** Free compute cannot be set to never sleep (N10). Staying awake at 0.25 CU is 0.25 × 24 = 6 CU-hours a day, so the 100 CU-hours a month would be used up in about 17 days and the compute would be suspended (N9d). | A: free; the first request after 5 idle minutes is slower ("a few hundred milliseconds" of wake-up plus a cold function). B: breaks the plan. Also log in or redeploy every 2 weeks, and keep a copy of the seed (V7c, N14b). |
| 7 | **`DEMO_MODE=true` on the public production URL** | A. True: the API returns the login code in the response for demo phones, so a reviewer can log in without SMS (D77). B. False: nobody can log in, because the mock sender sends nothing. | **A**, with fictional data only, no real secrets in the app, and a kill switch: set `DEMO_MODE=false` and redeploy. Anyone who finds the URL can sign in as any seeded user, including staff with `payments:approve`. | A: free; the risk is that a stranger fills or damages the demo database, which is capped at 1 GB and can be re-seeded. B: no live demo. |
| 8 | **Node version.** `package.json` says `engines.node: ">=24"`, and Vercel maps open-ended ranges such as `>=22.0.0` to the **latest 26.x** (V2). By the same rule `>=24` should also give Node **26** (my inference from that table, not a quoted example), not the 24.15.0 we test on. | A. Change `engines.node` to `24.x` (a one-line code change, a new task). B. Leave it and accept Node 26. C. Only set Node 24.x in the Vercel console (the `engines` value overrides it, so this fails). | **A.** Next.js 16 and Prisma 7 were tested here on Node 24.15.0 only. | A: free, one small commit. B: untested runtime. |
| 9 | **Move `pg` from devDependencies to dependencies?** | A. Leave it. B. Move it. | **A.** The app imports only `@prisma/adapter-pg`, which depends on `pg@8.23.1`, so `pg` is already in production (`npm ls pg --omit=dev`, V5c). Move it only if the first deployed login fails with "Cannot find module 'pg'". | Free either way. |
| 10 | **Do not use the Neon-Vercel integration.** | A. Set the variables by hand (recommended). B. Install the integration. | **A.** The integration fills `DATABASE_URL` with the owner role (N16), which could edit the append-only tables. | A: a few minutes in the Vercel dashboard. |
| 11 | **Hobby content terms.** Vercel's terms (as returned by the fetch tool) say Hobby users agree "we may use Your Content to train our artificial intelligence" models (N15b). | A. Accept (the code and the fictional data only). B. Do not deploy on Vercel. | **Your call.** Read section 3 of https://vercel.com/legal/terms yourself first. | A: free. B: no live URL. |
| 12 | **Production branch and commit author.** The repository has only `master`. A Hobby team deploys a commit only if its author is the Hobby team's owner, matched through the linked GitHub login (V9b). | A. Keep `master`, confirm it is the Production Branch, and make sure the commit e-mail is on your GitHub account. B. Rename to `main`. | **A.** Renaming is an ask-first git operation. | Free. |

## Facts table

"Page date" is the "last updated" date printed on the page. "none" means the page prints no date.
Every page was fetched on 2026-11-06.

### Vercel

| # | Question | Answer | Source | Page date |
|---|---|---|---|---|
| V1a | Does the Hobby plan exist, and what does it cost? | Yes. "The Hobby plan is **free**." The pricing page says "$0/mo." | https://vercel.com/docs/plans/hobby ; https://vercel.com/pricing | 2026-09-14 ; none |
| V1b | Hobby limits | Function max duration **300 s** (default and max); memory **2 GB / 1 vCPU**; included per month: Fast Data Transfer **100 GB**, Fast Origin Transfer **10 GB**, CDN requests **1,000,000**, function invocations **1,000,000**, Active CPU **4 hours**, provisioned memory **360 GB-hrs**; **100 deployments a day**; **1 concurrent deployment**; **200 projects**; build time **45 minutes** per deployment, 2 vCPU / 8 GB build machine; request or response body **4.5 MB**; function bundle **250 MB** uncompressed; runtime logs kept **1 hour**; **64 KB** of environment variables per deployment. | https://vercel.com/docs/plans/hobby ; https://vercel.com/docs/limits ; https://vercel.com/docs/functions/limitations | 2026-09-14 ; 2026-09-16 ; 2026-08-24 |
| V1c | Cron jobs on Hobby | 100 cron jobs per project, but the minimum interval is **once per day** and precision is "Per-hour (±59 min)". See V6. | https://vercel.com/docs/cron-jobs/usage-and-pricing (canonical: /docs/schedules/cron-jobs/usage-and-pricing) | 2026-07-15 |
| V1d | What happens past a Hobby limit? | "if you exceed your usage limits on the Hobby plan, you will have to wait until 30 days have passed before you can use the feature again." Hobby cannot buy extra usage. | https://vercel.com/docs/plans/hobby ; https://vercel.com/pricing | 2026-09-14 ; none |
| V1e | Commercial use | Forbidden: "Hobby teams are restricted to non-commercial personal use only." Commercial use is "any Deployment that is used for the purpose of financial gain of anyone involved in any part of the production of the project, including a paid employee or consultant writing the code." Examples: taking payment from visitors, advertising a product, receiving payment to create or host the site, ads. "Asking for Donations does not fall under commercial usage." | https://vercel.com/docs/limits/fair-use-guidelines | 2026-09-14 |
| V1f | Is a payment card needed to sign up? | **Not found.** The account page says you sign up "with an email address or a Git provider" (GitHub, GitLab, Bitbucket) and names no card. The pricing page says "Hobby is free, and the first deploy does not need an account"; it has no "no card" sentence. A Pro trial and the Pro plan ask for card details; Hobby does not appear in those steps. | https://vercel.com/docs/accounts ; https://vercel.com/pricing ; https://vercel.com/docs/plans/hobby | 2026-09-21 ; none ; 2026-09-14 |
| V2 | Node versions and how to set one | Available: **26.x (default), 24.x, 22.x**. "Only major versions are available"; Vercel rolls minor and patch updates itself. Set in Project Settings > Build and Deployment > Node.js Version, or in `package.json` `engines.node`, which overrides the project setting. Table on the page: `26.x`, `^26.0.0` and **`>=22.0.0` all map to the latest 26.x**; `24.x` and `^24.0.0` map to the latest 24.x. `.nvmrc`: **not documented** as a source of the build version (a search over vercel.com found it only as a "keep your pins aligned" hint and a conformance rule). | https://vercel.com/docs/functions/runtimes/node-js/node-js-versions ; search of vercel.com for `.nvmrc` | 2026-02-27 ; n/a |
| V3a | How is the function region set? | Default is **`iad1` (Washington, D.C.)** for new projects. Set it in Project Settings > Functions > Function Regions, in `vercel.json` `"regions": [...]`, or with `vercel --regions`. | https://vercel.com/docs/functions/configuring-functions/region | 2026-08-11 |
| V3b | Regions, and which is closest to India | 19 regions. India: **`bom1` (Mumbai, ap-south-1)**. Also `sin1` (Singapore, ap-southeast-1), `hkg1`, `hnd1`, `icn1`, `kix1`, `syd1`. | https://vercel.com/docs/regions | 2026-08-11 |
| V3c | Does Hobby limit region choice? | Hobby gets a **single region** ("Hobby: Single region"). The page does not say Hobby is restricted to particular regions. Deploying to more regions than the plan allows fails before the build. | https://vercel.com/docs/functions/configuring-functions/region | 2026-08-11 |
| V4a | How are environment variables scoped? | Each variable is set for one or more of **Production, Preview, Development** (and custom environments). Preview applies "to a push to a branch that is not the Production Branch". Changes "are not applied to previous deployments, they only apply to new deployments." Variables are either **Config** (readable by members with access) or **Secret** (write-only after saving). Limit 64 KB total. | https://vercel.com/docs/environment-variables | 2026-09-17 |
| V4b | Can a Preview deployment use production secrets? | Only if the variable's environments include Preview. Prisma's Vercel guide warns: "Vercel uses the `DATABASE_URL` you define at import for both production and preview", so a migration in a pull request could change the production database. Its advice: add a second `DATABASE_URL` enabled for **Preview only**, pointing at a separate database. | https://vercel.com/docs/environment-variables ; https://www.prisma.io/docs/orm/prisma-client/deployment/serverless/deploy-to-vercel | 2026-09-17 ; none |
| V4c | System variable `VERCEL` | `VERCEL=1` is "available at both build and runtime" but is "an indicator to show that system environment variables have been exposed". They are exposed when **Environment Variables > "Enable access to System Environment Variables"** is checked. Our `clientIp` trusts proxy headers only when `VERCEL=1`, so this box must be ticked. | https://vercel.com/docs/environment-variables/system-environment-variables | 2026-07-15 |
| V5a | Are devDependencies installed at build? | Yes. The install command "installs dependencies from `package.json`, including `devDependencies` (which can be excluded)". The default build command is `next build`, or the `build` script. | https://vercel.com/docs/builds/configure-a-build | 2026-08-28 |
| V5b | Prisma generate step | Prisma's guide: put `prisma generate` in the `postinstall` script (we do). Vercel caches dependencies, which "may result in an outdated version of Prisma Client on a change in your Prisma schema" (the fix is the postinstall). If a deploy fails with `prisma: command not found`, move `prisma` to dependencies. Run migrations from a `vercel-build` script only in a CI/CD setup. The page does not discuss `prisma.config.ts` or Prisma 7 settings. | https://www.prisma.io/docs/orm/prisma-client/deployment/serverless/deploy-to-vercel | none |
| V5c | Will `pg` be in the deployed function? | **Likely yes, and checkable now.** `src/server/db.ts` imports only `@prisma/adapter-pg`. `npm ls pg --omit=dev` (run locally) shows `@prisma/adapter-pg@7.10.1` depends on `pg@8.23.1`, so `pg` is a production dependency of the adapter. Our own direct `import "pg"` is only in the seed CLI and its types. Vercel installs devDependencies anyway (V5a). Neither Vercel nor Prisma pages say how function files are traced; **not found**. The proof is a deployed login (see the smoke test). | local `npm ls pg --omit=dev` ; V5a | n/a |
| V5d | Does `prisma generate` need `DATABASE_URL` at build? | No. Run locally in a copy with no `.env` and `DATABASE_URL` unset: "Generated Prisma Client (7.10.1)". `next build` also passed here without a database. | local test, 2026-11-06 | n/a |
| V5e | Next.js on Vercel | Route Handlers become Vercel Functions; SSR "scales to zero when not in use"; Next.js 16 is covered (the page describes Next.js 16 Cache Components). Functions use Fluid compute by default. | https://vercel.com/docs/frameworks/full-stack/nextjs ; https://vercel.com/docs/limits | 2026-09-08 ; 2026-09-16 |
| V6 | Cron: syntax, limits, authentication | `vercel.json`: `"crons": [{ "path": "/api/x", "schedule": "0 5 * * *" }]`. Time zone is always **UTC**; no day names; not both day-of-month and day-of-week. Vercel makes an HTTP **GET** to the **production** deployment URL, user agent `vercel-cron/1.0`, header `x-vercel-cron-schedule`. **Hobby: once per day only**; a more frequent expression "will fail deployment". Timing: `0 1 * * *` "will trigger anywhere between 1:00 am and 1:59 am". Authentication: set env var **`CRON_SECRET`** (16 characters or more, header-safe characters); Vercel sends `Authorization: Bearer <value>`. "Vercel will not retry an invocation if a cron job fails." Delivery is "best effort", and can run twice or not at all: "cron jobs should be resilient to both missed runs and duplicate runs". Cron does not run on preview deployments. Redirects are not followed. A `CRON_SECRET` edit applies only after the next deployment. The page calls Cron Jobs "a legacy feature" to be migrated to "Schedules". | https://vercel.com/docs/cron-jobs ; /docs/cron-jobs/usage-and-pricing ; /docs/cron-jobs/manage-cron-jobs (canonical under /docs/schedules/cron-jobs) | 2026-09-16 ; 2026-07-15 ; 2026-08-11 |
| V7a | What happens to an inactive free project? | The Vercel pages fetched say **nothing about pausing a Hobby project for inactivity**. The "why was my account or deployment paused" page lists spend limits, usage limits, policy violations, platform incidents and billing problems, and says "The page does not mention inactivity as a cause" (fetch-tool wording). | https://vercel.com/kb/guide/why-is-my-account-deployment-blocked | 2026-10-02 |
| V7b | What do the Terms say? | Section 4: Vercel may "disable or remove any Project or website deployment on the Hobby plan with or without notice" and "shut down and terminate projects or deployments using the Hobby plan without notice for any reason or no reason". Section 19.1: Vercel "reserves the right to terminate accounts that are inactive for an extended period of time", and content "may be permanently deleted" on termination. "Extended period" is **not defined** (not found). Section 10.1: "maintain your own backups of Your Content". | https://vercel.com/legal/terms | "Last Updated: October 19, 2026" |
| V7c | What keeps it up for 40 days? | **Not found** as a stated guarantee. The documents give no inactivity threshold for Vercel. Practical answer: keep the account and project in normal use (log in, redeploy or open the dashboard at least every two weeks), keep the daily cron running, and keep a copy of the data (the seed is reproducible). See Decision 6. | n/a | n/a |
| V8 | Client IP headers | Still current. `x-forwarded-for`: "The public IP address of the client that made the request." Vercel "overwrite[s] the X-Forwarded-For header and do[es] not forward external IPs. This restriction is in place to prevent IP spoofing." `x-real-ip` "is identical to the `x-forwarded-for` header." `x-vercel-forwarded-for` "is identical to the `x-forwarded-for` header. However, `x-forwarded-for` could be overwritten if you're using a proxy on top of Vercel." A custom X-Forwarded-For needs an Enterprise trusted proxy. Our `clientIp` order (`x-vercel-forwarded-for`, `x-real-ip`, `x-forwarded-for`, only when `VERCEL=1`) matches. | https://vercel.com/docs/headers/request-headers | 2025-12-13 |
| V9a | Deployment Protection defaults | Protection scope options: Standard Protection "protects all deployments **except** production domains"; "All Deployments" protects production too; both are available on Hobby with Vercel Authentication. Password Protection is **not available on Hobby** (Pro, $20 per month per project). So on Hobby the production domain can be public while previews need a Vercel login. The default for a new project is **not found** on the page; check the setting in the console. | https://vercel.com/docs/deployment-protection | 2026-09-15 |
| V9b | Git and the production branch | The production branch is chosen as `main`, else `master`, else the repository default. Change it under Project Settings > Environments > Production > Branch Tracking. Every other branch gets a preview deployment. A Hobby team cannot deploy a private repository owned by a GitHub organisation (ours is a personal account). "To deploy commits under a Hobby team, the commit author must be the owner of the Hobby team", checked through Login Connections. | https://vercel.com/docs/git | 2026-09-18 |

### Neon

| # | Question | Answer | Source | Page date |
|---|---|---|---|---|
| N9a | Free plan limits | **$0/month.** 100 projects; 10 branches per project; **1 GB** storage per project (20 GB total); **100 CU-hours** a month per project (the page says that is a 0.25 CU compute running 400 hours); compute up to 2 CU (8 GB); scale to zero after 5 minutes, "cannot disable"; **5 GB** public network transfer per project a month; **6 hours** of instant-restore history (up to 1 GB of changes); 1 manual snapshot; monitoring history 1 day; community support. | https://neon.com/docs/introduction/plans ; https://neon.com/faqs/free-plan-limits-and-quotas | 2026-11-04 ; 2026-10-01 |
| N9b | Is a card needed? | **Not found.** Neither page says a card is required for Free. | same | same |
| N9c | Connection limits | The plans page and FAQ give **no** connection limit for Free (not found). The pooling page gives `max_connections` by compute size: **0.25 CU = 104**, 0.5 CU = 209, 1 CU = 419, 2 CU = 839; seven are reserved for Neon's superuser. | https://neon.com/docs/connect/connection-pooling | 2026-10-19 |
| N9d | When a limit is exceeded | Compute or transfer: the compute "is suspended until the next billing period or until you upgrade." Storage: operations that increase storage "fail once you hit" the cap. Branch creation fails at 10. "None of these limits delete your data." No charge is described for Free. | https://neon.com/docs/introduction/plans | 2026-11-04 |
| N10 | Scale to zero | Free: compute "scales to zero after an inactive period of 5 minutes"; "For Neon Free plan users, this setting is fixed." On the next query it "reactivates automatically within a few hundred milliseconds." The page does not spell out the effect on the first request, or what session state is lost (**not found**). Prisma's Neon guide: a `P1001: Can't reach database server` error is likely a timeout while the compute wakes; add `connect_timeout` (example 15 seconds). | https://neon.com/docs/introduction/scale-to-zero ; https://neon.com/docs/guides/prisma | 2026-11-04 ; 2026-10-05 |
| N11a | Pooled or direct | Pooled string: add `-pooler` to the host. PgBouncer in **transaction mode**, up to 10,000 client connections. Use **direct** for migrations ("Tools may not support transaction pooling"), `pg_dump`, admin tasks. Not supported through the pooler: `SET`/`RESET`, `LISTEN`/`NOTIFY`, `WITH HOLD CURSOR`, SQL-level `PREPARE`/`DEALLOCATE`, some temp tables, `LOAD`, and **session-level advisory locks**. Protocol-level prepared statements are supported (PgBouncer 1.22 or later, `max_prepared_statements=1000`). | https://neon.com/docs/connect/connection-pooling | 2026-10-19 |
| N11b | Prisma 7 with Neon | Neon's guide: app on the pooled `DATABASE_URL`, Prisma CLI on the direct `DATABASE_URL_UNPOOLED` (set in `prisma.config.ts`). It uses `@prisma/adapter-neon`; **`@prisma/adapter-pg` is not covered** by that page, nor are prepared statements or advisory locks with `migrate deploy`. Prisma's Vercel guide does show `PrismaPg` from `@prisma/adapter-pg` over a `pg` Pool. We use `adapter-pg`. | https://neon.com/docs/guides/prisma ; https://www.prisma.io/docs/orm/prisma-client/deployment/serverless/deploy-to-vercel | 2026-10-05 ; none |
| N11c | Is `pg_advisory_xact_lock` safe through the pooler? | **Not found.** Neon's list names only session-level advisory locks as unsupported, and says nothing about transaction-level ones. PgBouncer's feature page also names only session-level advisory locks ("Never") and does not mention `pg_advisory_xact_lock`. Reasoning, not a quote: in transaction mode a client keeps one server connection for the whole transaction, and a transaction-level lock is released at its end, so it should behave. This must be **confirmed on Neon** (see the smoke test) before relying on it. `prisma migrate deploy` uses a lock too, which is why it must use the direct connection. | https://neon.com/docs/connect/connection-pooling ; https://www.pgbouncer.org/features.html | 2026-10-19 ; none |
| N12a | Default role | The project role is named for the database; for `neondb` it is **`neondb_owner`**, and owns the database. It is a member of **`neon_superuser`** (CREATEDB, CREATEROLE, BYPASSRLS, REPLICATION, `pg_read_all_data`, `pg_write_all_data`, `pg_monitor`, `pg_signal_backend`). Neon says you "can't connect using the Postgres `superuser` account". Whether `neondb_owner` itself is a Postgres superuser: **not stated** (the page implies it is not). | https://neon.com/docs/manage/roles | 2026-11-05 |
| N12b | Making another role | SQL: `CREATE ROLE <name> WITH LOGIN PASSWORD '...';`. Roles made with SQL "are not added to `neon_superuser`" and get only the basic privileges of a plain Postgres install. Roles made in the Console, API or CLI **are** given `neon_superuser` membership. So the app role must be made in SQL. SQL passwords need at least 60 bits of entropy. | https://neon.com/docs/manage/roles | 2026-11-05 |
| N12c | Can an owner disable triggers? | PostgreSQL 18 docs: "You must own the table to use `ALTER TABLE`." `DISABLE TRIGGER` of ordinary triggers needs only that; "Disabling or enabling internally generated constraint triggers requires superuser privileges" (foreign-key triggers). Our append-only triggers are ordinary triggers, so **the table owner can disable them**. `session_replication_role`: "Only superusers and users with the appropriate `SET` privilege can change this setting"; set to `replica`, triggers "will not fire". Whether `neondb_owner` holds that `SET` privilege: **not found** in Neon's page. | https://www.postgresql.org/docs/current/sql-altertable.html ; https://www.postgresql.org/docs/current/runtime-config-client.html | PostgreSQL 18.6 docs, none |
| N12d | Owner rights | "The right to modify or destroy an object is inherent in being the object's owner, and cannot be granted or revoked in itself." The `TRIGGER` privilege "allows creation of a trigger" and needs "great care". Which Postgres major version Neon runs by default, and whether its behaviour matches PostgreSQL 18 docs: **not found** (our local database is Postgres 16). | https://www.postgresql.org/docs/current/ddl-priv.html | PostgreSQL 18.6 docs, none |
| N13a | Regions | AWS Asia Pacific: **Singapore `aws-ap-southeast-1`** (all products) and **Sydney `aws-ap-southeast-2`** (Postgres only). **Mumbai is not listed.** | https://neon.com/docs/introduction/regions | 2026-10-14 |
| N13b | Change region later? | No: "You cannot change the region" of an existing project; you create a new project and move the data. | same | same |
| N13c | Same region as Vercel? | Vercel `sin1` is listed as `ap-southeast-1`, the same AWS region id as Neon Singapore. Neon's page says nothing about Free plan region limits (**not found**). | https://vercel.com/docs/regions ; https://neon.com/docs/introduction/regions | 2026-08-11 ; 2026-10-14 |
| N14a | Backup and restore on Free | **6 hours** of history ("instant restore"); 1 manual snapshot. Restore overwrites the branch, creates a backup branch `{branch}_old_{timestamp}`, and "your connection details do not change". The restore page itself gives no Free window (it points to the plans page). Nothing longer than 6 hours is offered on Free. | https://neon.com/docs/introduction/plans ; https://neon.com/docs/introduction/branch-restore | 2026-11-04 ; 2026-09-25 |
| N14b | What deletes data? | Plan limits do not ("None of these limits delete your data"). **Sources disagree on inactivity.** The Azure deprecation page says: "Projects on Free plans that have been inactive for 90 days or more are subject to deletion", with "Projects in Free organizations that have been inactive for 90 days or more are subject to deletion" in its October 5, 2026 row, and also "Projects in AWS regions are not affected". The regions page repeats the 90-day sentence inside its Azure warning. The plans page and the Free FAQ say nothing about deleting inactive Free projects. Whether the 90-day rule applies outside Azure: **not found**. A search summary said Neon's pricing page states Free projects are not paused for inactivity; that page was not fetched here, so it is unverified. "Inactive" is not defined. | https://neon.com/docs/import/azure-regions-deprecation ; https://neon.com/docs/introduction/regions ; https://neon.com/docs/introduction/plans | 2026-10-17 ; 2026-10-14 ; 2026-11-04 |
| N15a | Neon terms | The page found ("Product Specific Schedule", last updated October 14, 2026) has **no acceptable-use policy**; it refers to a Databricks agreement not reproduced there. Its only data rule: customers shall not put "cardholder data as defined under PCI-DSS" in Customer Content. Free-plan suspension or deletion: **not addressed** there. | https://neon.com/terms-of-service | October 14, 2026 |
| N15b | Vercel terms on personal data and AI | Section 10.1: configure Your Content so it "will not expose personal data or personal information without proper consent from individuals." Section 8: use "must comply with Vercel's Acceptable Use Policy" (that policy was **not fetched**). Section 3, as returned by the fetch tool: Hobby users agree "we may use Your Content to train our artificial intelligence" models. Our demo holds only fictional names and numbers, but the **source code** is Your Content too; read section 3 yourself before deploying. | https://vercel.com/legal/terms | "Last Updated: October 19, 2026" |
| N16 | Neon and Vercel integration | The native integration sets `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (direct), `PG*` and `POSTGRES_*` variables, and can create a database branch for every preview deployment (`preview/<git-branch>`, copy-on-write from the default branch). It sets the owner connection details. The page does not say whether Free is available or whether a card is needed (**not found**). We do **not** plan to use it (see the plan). | https://neon.com/docs/guides/vercel-managed-integration | 2026-10-23 |
| N17 | Sign-up | **Not found.** Neon's console-tour page says it "assumes you've already signed up". It confirms the default database is `neondb` and the console default branch is named `production` (`main` when made with the CLI or API). | https://neon.com/docs/get-started/signing-up | 2026-10-09 |

## Things this research could not establish

These are all "not found" above, listed once so nobody mistakes silence for a yes.

1. Whether Vercel or Neon asks for a payment card or a phone number when a Hobby or Free account is created.
2. How long an account may be inactive before Vercel terminates it ("an extended period of time").
3. Whether Neon's 90-day inactivity deletion applies to Free projects in AWS regions.
4. Whether `pg_advisory_xact_lock` works as expected through Neon's pooler.
5. Whether `neondb_owner` may run `SET session_replication_role = replica` (which would let an owner skip triggers).
6. The Postgres major version Neon creates for a new project today.
7. How Vercel traces files into a function (so only a deployed login proves `pg` is present).
8. The default Deployment Protection setting for a new Hobby project.
9. Vercel's Acceptable Use Policy text, and Neon's acceptable-use terms.

## Recommended architecture

```
Reviewer's browser
      |  https (public production URL, *.vercel.app)
      v
Vercel (Hobby, one region: sin1)
  - Next.js 16 on Node 24.x, one Vercel Function per route
  - env (Production only): DATABASE_URL (app role, pooled), OTP_PEPPER, PAYMENT_WEBHOOK_SECRET, DEMO_MODE, ...
  - daily cron (UTC, any time in the hour) -> GET /api/cron/... with Authorization: Bearer CRON_SECRET
      |  TLS, role township_app (not the table owner), host ...-pooler...
      v
Neon pooler (PgBouncer, transaction mode)
      |
      v
Neon Free project (aws-ap-southeast-1): Postgres, database neondb
  - tables owned by neondb_owner (migrations only); township_app has SELECT/INSERT/(column) UPDATE
  - append-only triggers and the partial unique index live here

The human's laptop (never Vercel):
  - owner DIRECT url, only in a shell, for `prisma migrate deploy`, the seed and the role grants
```

Why this shape: the free tiers have no always-on worker (D10), so work runs inside requests, after responses, and in
one daily cron. The app role is not the table owner, so a bug or an attack in the web app cannot switch off the
append-only triggers (see "Database role design"). The owner's connection string never leaves the human's
laptop and is never stored in Vercel.

## Environment variables

Names only. No value belongs in a commit, a chat, or a screenshot. "Set by" says who types the value, and where.

| Name | What it is | Set by | Environments | Secret? |
|---|---|---|---|---|
| `DATABASE_URL` | Neon **pooled** connection string (host contains `-pooler`) for the **app role** `township_app`, with `?sslmode=require` | You, in the Vercel dashboard (Settings > Environment Variables) | **Production only** (Preview and Development: not set) | Secret |
| `DATABASE_URL_UNPOOLED` | Neon **direct** connection string for the **owner** role, for migrations, the seed and the grants | You, in your own shell only, for one command at a time | **Not in Vercel at all** | Secret |
| `OTP_PEPPER` | Random value, at least 32 characters, not starting with `replace-with` (the app refuses it in production) | You: generate it on your machine and paste it only into the Vercel dashboard | Production only | Secret |
| `PAYMENT_WEBHOOK_SECRET` | Random value, at least 32 characters, not starting with `replace-with` (the webhook refuses to verify with a weaker one in production). It signs the payment events, so it is **not** the Neon string and not the pepper | You: generate it on your machine and paste it **only into the Vercel dashboard** | Production only | Secret |
| `DEMO_MODE` | `true` returns the login code in the response for demo phones (D77); see Decision 7. In your shell it also unlocks the seed | You, in Vercel (`true` or `false`) | Production only | Config (not secret) |
| `SHOW_DESIGN_PAGE` | `false` hides `/design` | You, in Vercel | Production only | Config |
| `DEMO_AS_OF` | **Optional, leave unset.** Freezes the business date to 12:00 India time on that date, to reproduce the brief's sample numbers locally (D97). On a live site the real date is the truth | **Nobody sets it in Vercel** | none | Config |
| `CRON_SECRET` | Random string of 16 or more letters and digits; Vercel sends it as `Authorization: Bearer ...` to the cron route | You, in Vercel, **when the cron route is built** (not used by any code yet) | Production only | Secret |
| `LLM_API_KEY` | Key for the complaint classifier (D73) | **Not set now.** Set it when the classifier is built | Production only | Secret |
| `JEV_PRIMARY_URL`, `JEV_PRIMARY_KEY`, `JEV_PRIMARY_MODEL` | The classifier's first provider, OpenCode (D140). The URL and the key are needed, else the provider is skipped. The model is optional (D144): left out, the request has no `model` field and the provider chooses. The URL must be https | You, **only in the Vercel dashboard** (the key is never pasted in chat, a file, an issue or a log) | Production only | Key: Secret. URL, model: Config |
| `JEV_SECONDARY_URL`, `JEV_SECONDARY_KEY`, `JEV_SECONDARY_MODEL` | The second provider, jevmodel.app (unverified operator, limited free tier). Same rules, the model optional | You, **only in the Vercel dashboard** | Production only | Key: Secret. URL, model: Config |
| `JEV_TIMEOUT_MS`, `JEV_DAILY_CAP`, `JEV_BREAKER_FAILURES`, `JEV_BREAKER_COOLDOWN_SECONDS` | Optional tuning: 500 to 4000 ms (3000), 1 to 100000 calls a day per provider (300), failures before the breaker opens (3), cooldown (120 s). An invalid value stops the classifier at start-up | You, in Vercel, only to change a default | Production only | Config |
| `SESSION_SECRET` | Appears in `.env.example`, but **no code reads it**: sessions are database rows with hashed tokens (D16, D79) | **Do not set.** Remove it from `.env.example` in a later task | none | n/a |
| `NODE_ENV` | `production` on Vercel; the app needs it to refuse a weak pepper (the cookie name follows the request scheme, not this) | Vercel and Next.js set it. Do not set it by hand | automatic | no |
| `VERCEL`, `VERCEL_ENV` | System variables. `clientIp` trusts proxy headers only when `VERCEL=1`, which exists only if **"Enable access to System Environment Variables"** is ticked (V4c) | You: tick the box once | automatic | no |
| `DB_POOL_MAX` | Optional. The most database connections one function instance opens: a whole number from 1 to 10 (default 5). Anything else makes the app throw at first use | You, in Vercel, only if you want to change it | Production only | Config |
| `BASE_URL` | The deployed address, for the smoke test only | You, in your own shell | n/a | no |

Rules that go with this table:

- A value is typed by you, straight into the Vercel dashboard or a local prompt. It is never pasted into the agent's chat.
- Use the **Secret** type in Vercel for every secret above (write-only after saving, V4a). Because it cannot be read
  back, keep the pepper in your own password manager.
- Variable changes apply only to **new** deployments (V4a). After any change, redeploy.
- `DATABASE_URL` is scoped to Production only. A preview then has no database and fails closed (Decision 4).

## Connection settings (T9b)

`src/server/db-options.ts` (`dbPoolOptions`) holds the numbers; `src/server/db.ts` passes them to the Prisma pg adapter.

| Setting | Value | Why |
|---|---|---|
| Pool size (`max`) | **5** by default; `DB_POOL_MAX` may set 1 to 10; any other value throws a `RangeError` | Each function instance has its own pool. Neon's pooler shares the real connections (10,000 clients, N11a), so a small pool is enough, and many instances times a large pool would waste connections. A wrong setting stops the app loudly instead of quietly changing behaviour. |
| Connection timeout | **8,000 ms** | Prisma 7's pg adapter defaults to 0, which means no timeout ("Connection timeout: 0 (no timeout) vs v6's 5s"). Without a limit a database that cannot be reached holds the request until Vercel ends the function (300 s on Hobby). Neon wakes "within a few hundred milliseconds" (N10), so 8 s is far above a normal cold start and far below the function limit. |
| Idle timeout | **10,000 ms** | The adapter's own default in Prisma 7. An idle connection is closed before a suspended function would hold it. |
| Per-query timeout (`query_timeout`) | **10,000 ms** | A client-side limit: the pool stops waiting for a slow query. It does not tell the server to stop, so a runaway query keeps running on Neon until it finishes. |

Source for the adapter: https://www.prisma.io/docs/orm/overview/databases/postgresql (no last-updated date on the page). It
shows `new PrismaPg({ connectionString })`, names `connectionTimeoutMillis`, and gives the Prisma 7 defaults (connection
timeout 0, idle timeout 10 s). `PrismaPg` takes a `pg` pool configuration (its type is `pg.PoolConfig | string`), so `max`,
`idleTimeoutMillis` and `query_timeout` pass through; the page does not list them, so they are tested rather than assumed
(`tests/integration/db-timeouts.test.ts`: a server that never answers is given up on within 1,500 ms for a 500 ms setting,
through both a `pg` pool and Prisma; a 2-second `pg_sleep` is abandoned after 300 ms and the pool still works).

Not set on purpose: `statement_timeout`. As a connection setting it is sent when the connection starts, and Neon's pooler
does not accept some start-up options (its Prisma guide says `options=-c search_path=...` "works only on the direct
(unpooled) connection", N11b). A server-side limit could instead be set on the app role (`ALTER ROLE ... SET statement_timeout`);
that is untested on Neon and left for a later decision.

## Database role design

### Why a separate role

On Neon, the default role `neondb_owner` creates the tables when migrations run, so it **owns** them. PostgreSQL says
"You must own the table to use `ALTER TABLE`" and "the right to modify or destroy an object is inherent in being the
object's owner, and cannot be granted or revoked in itself" (N12c, N12d). Our append-only rules (`ledger_entries`,
`payment_matches`, `complaint_events`, `classifications`, `audit_log`) are ordinary triggers, and an owner may run
`ALTER TABLE ledger_entries DISABLE TRIGGER ALL`; after that it can `UPDATE` or `DELETE` ledger rows freely.
`neondb_owner` is also a member of `neon_superuser` with `pg_write_all_data` and `BYPASSRLS` (N12a). If the web app
connected as the owner, any bug that let an attacker run SQL would let them rewrite the ledger and the audit log.

A second role that does **not** own the tables cannot run `ALTER TABLE ... DISABLE TRIGGER`, `DROP TRIGGER` or
`DROP TABLE`, and has only the privileges granted to it. It is also not a member of `neon_superuser`, because it is
made with SQL (N12b), not in the Neon console, API or CLI (those make `neon_superuser` members).

Two things the documents did not settle (both "not found" above): whether `neondb_owner` may set
`session_replication_role = replica` (which makes triggers not fire), and the Postgres version Neon runs. So the plan
**tests** instead of assuming: the checks below must show that the app role is refused each of these.

### Roles

| Role | Used for | Created how | Credentials live |
|---|---|---|---|
| `neondb_owner` (Neon default) | Owns every table and function. Runs `prisma migrate deploy`, the seed and the grants. | Neon creates it | Your laptop and password manager only. **Never in Vercel.** |
| `township_app` | The web app at runtime. Not an owner, no `neon_superuser`, no `CREATE` on schema `public`. | **SQL**, run once as `neondb_owner` (below) | Vercel `DATABASE_URL` (Production, Secret) |

### Creating the role and applying the grants (step order)

The grants are no longer typed by hand. They are generated from one matrix in `src/server/db-roles/app-role.ts`
(`buildAppRoleSql`) and proven by tests, so this document cannot drift from the code. **Where the brief for T9b said the human
creates the role in the Neon console, this plan is followed instead:** a role made in the console, API or CLI becomes a
member of `neon_superuser` (N12b), which would give the app the power this design removes. So the role is made with SQL, and
the generated script refuses a role that has administrator attributes or is a member of `neon_superuser`.

1. **You create the role, with SQL, as the owner, on the direct connection** (Neon SQL Editor, or `psql` with the owner string).
   This statement sets no password; set it with the prompt so it never reaches a file or the chat:
   ```sql
   CREATE ROLE township_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
   -- psql:  \password township_app
   -- Neon SQL Editor (no prompt): ALTER ROLE township_app WITH PASSWORD '<32 random characters, from your password manager>';
   ```
2. **Print the grants** (on your laptop; it connects to nothing and accepts no password):
   ```bash
   npm run db:print-app-role-sql -- --app=township_app --owner=neondb_owner > app-role.sql
   ```
   Do not commit `app-role.sql` (it is reproducible from the code). Read it once.
3. **Run it as the owner**, on the direct connection: `psql "$DATABASE_URL" -f app-role.sql`, or paste it into the Neon SQL Editor.
   It stops with a clear message if you run it as the wrong role, if `township_app` does not exist, has admin attributes, is a
   `neon_superuser` member or owns a table, or if the schema has a table with no decision in the matrix. Running it again is safe
   and takes back any privilege that was added by hand.
4. **Verify** with the checks below (the same ones that the tests run against a local database).
5. **Only then** build the app's connection string and put it, and only it, in Vercel as `DATABASE_URL` (Production, Secret).

What the grants do, in short: connect and use the schema; `REVOKE` everything first (so a re-run resets the role); `SELECT`/`INSERT`
only on the five append-only tables; column-level `UPDATE` on `sessions` (`last_seen_at`, `revoked_at`) and `otp_codes`
(`attempts`, `consumed_at`) only; nothing on `_prisma_migrations`; no `CREATE` on the schema; no default privileges, so a table
added by a later migration stays invisible to the app until it is added to the matrix. A test fails when a table has no decision.

**Tests that prove it** (`tests/integration/`, a fresh database and a uniquely named role with a random password, dropped afterwards):

| File | What it proves |
|---|---|
| `app-role-matrix.test.ts` | Every table in the migrated schema has a decision (or is in the no-access list); no stale entry. |
| `app-role.test.ts` | Allowed: inserts into the ledger, audit log and complaint events; the granted `UPDATE` columns; `SELECT` where the matrix says. Denied with 42501: `UPDATE`, `DELETE`, `TRUNCATE` on every append-only table (and `DELETE` and `TRUNCATE` on all tables); `ALTER TABLE ... DISABLE TRIGGER ALL`; `DROP TRIGGER`; `DROP TABLE`; `CREATE TABLE`, `CREATE ROLE`, `CREATE SCHEMA`; an ungranted column; `_prisma_migrations`; `SET session_replication_role = replica`. The triggers are still enabled afterwards. The privileges are read back from Postgres for every table. The script guards itself and can be run twice. |
| `app-role-flows.test.ts` | The real auth services (request and verify a code, create, resolve and revoke sessions, all audit writes, the `/api/me` data, `logout-all`, a 403) run through a Prisma client that logs in **as the app role**. They passed with the matrix unchanged, so the grants are enough for what the app does today. |

Mutation shown in T9b: adding `GRANT UPDATE ON "ledger_entries"` to the generator fails one unit test (every GRANT must be a
known form) and four integration tests (the exact-privileges read-back, the ledger UPDATE denial, the any-column UPDATE denial,
and the Prisma update refusal).

### Privilege matrix

The code (`PRIVILEGE_MATRIX`) is the source; this table is its summary.

S = SELECT, I = INSERT. "U(...)" is column-level UPDATE. "later" means UPDATE is granted by column when the feature
that writes those columns is built. No table gets DELETE.

| Table | Privileges now | Why |
|---|---|---|
| `ledger_entries` | S, I | Append-only (trigger). A correction is a new entry. |
| `payment_matches` | S, I | Append-only decision log (trigger). |
| `complaint_events` | S, I | Append-only history (trigger). |
| `classifications` | S, I | Append-only record of each classifier answer (trigger). |
| `audit_log` | S, I | Append-only (trigger). Evidence must not be editable by the app. |
| `sessions` | S, I, U(`last_seen_at`, `revoked_at`) | The code touches and revokes sessions only. It must not change `expires_at` or `user_id`. |
| `otp_codes` | S, I, U(`attempts`, `consumed_at`) | The code counts attempts and uses a code up. It must not change `expires_at` or `code_hash`. |
| `users` | S | Staff are seeded (D1). `U(language)` later (D44); `active` is changed by the owner. |
| `user_permissions` | S | Seeded; no admin screen (D1). |
| `flats`, `flat_members`, `society_settings`, `complaint_categories` | S | Reference data, seeded; no admin screen. |
| `bills` | S, I | A bill is written once; payments are ledger entries, not edits. |
| `statement_imports` | S, I | One row per file, never edited. |
| `known_payers` | S, I | A learned payer is added; removal is a decision for later. |
| `complaint_links`, `complaint_affected` | S, I | Links and affected flats are added, not edited. |
| `payment_attempts` | S, I, U(`status`, `debit_status`, `resolved_at`); more U later (`hold_*`, `escalated_at`, `resolved_by_id`, `release_reason`) | The signed webhook moves an attempt from INITIATED to SUCCEEDED or FAILED. The amount, bill, flat and gateway reference can never be changed by the app. |
| `bank_rows` | S, I, U(`state`, `flat_id`, `ledger_entry_id`, `version`) | A row is inserted QUEUED and moved to AUTO_MATCHED when it is posted. The narration, amounts, dates and dedupe key can never be changed by the app. |
| `accounts_queue_items` | S, I, U(`status`, `resolved_at`, `resolved_by_id`, `note`) | Staff resolve a bank-row item by a manual match or an ignore. The row it points at, its type and its opening time can never be changed by the app. |
| `complaints` | S, I; U on 13 columns (`status`, `assignee_id`, `category_id`, `urgency`, `response_due_at`, `first_response_at`, `pending_confirmation_at`, `closed_at`, `close_kind`, `rating`, `reopen_count`, `needs_review`, `version`); never the text, flat, raiser, language or safety flag | A complaint has a life cycle. |
| `outbox_jobs` | S, I; U later (`status`, `attempts`, `run_after`, `last_error`, `finished_at`) | The processor records progress. |
| `notifications` | S, I; U later (`status`, `sent_at`, `read_at`) | Delivery and read state. |
| `visitor_passes` | S, I; U later (`status`) | A pass is used or expires. |
| `_prisma_migrations` | none | Owner only. |

### Checks that must pass after the grants (run as `township_app`, pooled URL)

Each must fail with `permission denied` (SQLSTATE 42501) or an equivalent refusal. Run them in `psql`; they change nothing.

```sql
UPDATE ledger_entries SET note = 'x' WHERE false;          -- permission denied for table ledger_entries
DELETE FROM audit_log WHERE false;                         -- permission denied for table audit_log
ALTER TABLE ledger_entries DISABLE TRIGGER ALL;            -- must be owner of table ledger_entries
SET session_replication_role = replica;                    -- permission denied to set parameter
CREATE TABLE app_can_create (a int);                       -- permission denied for schema public
TRUNCATE audit_log;                                        -- permission denied for table audit_log
UPDATE sessions SET expires_at = now() WHERE false;        -- permission denied for table sessions (column not granted)
```

Run these as the owner to confirm the other side:

```sql
SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' ORDER BY 1;  -- every owner is neondb_owner, never township_app
SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type)
  FROM information_schema.role_table_grants
 WHERE grantee = 'township_app' AND table_schema = 'public' GROUP BY 1 ORDER BY 1;  -- compare with the matrix
SELECT rolname, rolsuper, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = 'township_app'; -- all false
SELECT pg_has_role('township_app', 'neon_superuser', 'member');                     -- false
```

If the `SET session_replication_role` check **succeeds** for the app role, stop: the role has more power than this
plan assumes. Tell the agent the **result** (not any connection string).

The current integration tests connect as the owner, so they cannot prove these grants. A later task should add a
test that connects as a non-owner role in a scratch database and runs the checks above, and a test that fails when
a migration adds a table with no grant line.

## Migration and seed procedure

All of this runs on **your laptop**, never in Vercel's build (a build that migrates would need the owner's string in
Vercel, and a preview could migrate the production database, V4b). The commands exist today except where marked.

Facts that the procedure relies on, checked here on 2026-11-06 with Node 24.15.0: a variable set in the shell is not
overwritten by a value in `.env` when `process.loadEnvFile` runs (tested with a throwaway file), and both
`prisma.config.ts` and the seed CLI call `loadEnvFile`. So a shell `DATABASE_URL` wins. The seed also prints
`Target: host ..., database ...` before it does anything; read that line.

1. **Create the Neon project** in Singapore (`aws-ap-southeast-1`), database `neondb`, and copy the **direct**
   connection string of the owner role (Console > Connect, with "Connection pooling" off; the host has no `-pooler`).
2. **Open a clean shell** and enter the string without echoing it:
   ```bash
   read -rs DATABASE_URL && export DATABASE_URL     # paste, press Enter; nothing is shown
   node -e 'const u=new URL(process.env.DATABASE_URL); console.log(u.hostname, u.pathname)'
   ```
   Expect a host ending `.neon.tech` with **no** `-pooler`, and `/neondb`.
3. **Migrate:** `npx prisma migrate deploy` then `npx prisma migrate status`. Expect all migrations applied and
   "Database schema is up to date!". Use the direct string only (N11a: migrations need it).
4. **Roles and grants:** run the SQL in "Database role design" as the owner, then the "Checks" block as `township_app`.
5. **Seed** (still the owner, direct string; `DEMO_MODE=true` is for this shell only and is separate from Vercel):
   ```bash
   export DEMO_MODE=true
   npm run db:seed -- --yes --allow-remote --confirm-database=neondb
   ```
   Check that the first printed line, `Target: host <your-endpoint>.neon.tech, database neondb`, is the Neon one. The
   command refuses a non-empty database, a remote host without `--allow-remote`, and a database name that does not
   match `--confirm-database` (`src/server/seed/guards.ts`). It prints row counts and `Database size`; compare the
   size with the 1 GB cap (N9a). A local seed into Postgres 16 measured **29.1 MB** on 2026-11-06 (T8c), so the 1 GB cap is not close; the Neon number will also include indexes and Neon's own overhead.
6. **Never** run `npm run db:reset-demo` against Neon: it refuses any host except localhost. To start over, recreate
   the database or the project in the Neon console, then repeat steps 3 to 5.
7. **Unset the shell variables** (`unset DATABASE_URL DEMO_MODE`) or close the terminal.

### After deploying the reconciliation screens: update the threshold setting (D116)

The demo's second-approver threshold is ₹10,000 (`APPROVAL_THRESHOLD_PAISE` in `src/domain/seed/settings.ts`), but the seed runs only on an
empty database, so a hosted database seeded earlier keeps ₹25,000 until the setting is changed. `society_settings` is writable by the
OWNER only (the app role has SELECT only, `src/server/db-roles/app-role.ts`), so the human runs this once in the Neon SQL Editor as the
owner (the same text is step E7 of `docs/deploy-checklist.md`, and a test runs it against a freshly seeded local database):

```sql
UPDATE society_settings SET value = '1000000'::jsonb WHERE key = 'approval_threshold_paise';
SELECT key, value FROM society_settings WHERE key = 'approval_threshold_paise';
```

Expected: `UPDATE 1`, then `1000000`. Until it is run, the live import and the review panel use ₹25,000 and the sample statement's three
queued credits of about ₹10,660 are posted by one person instead of waiting for a second approver.

### After deploying the committee report: insert the goals setting (R67)

The committee report reads three targets from the setting `committee_goals` (assumptions: 90 percent paid on time, 90 percent of first replies within the SLA, at
most 8 percent of resolved complaints reopened). A hosted database seeded earlier does not have the row; until it is inserted the report shows the built-in
defaults, which are the same numbers, and says so. The app role cannot write a setting, so the human runs this once in the Neon SQL Editor as the owner (the same
text is step E8 of `docs/deploy-checklist.md`, and a test runs it against a freshly seeded local database). It does nothing if the row exists:

```sql
INSERT INTO society_settings (key, value) VALUES ('committee_goals', '{"onTimeCollectionPercent": 90, "firstReplyWithinSlaPercent": 90, "reopenedPercentMax": 8}'::jsonb) ON CONFLICT (key) DO NOTHING;
SELECT key, value FROM society_settings WHERE key = 'committee_goals';
```

Expected: `INSERT 0 1` (or `INSERT 0 0`), then one row with the three numbers.

## Post-deploy smoke test

`npm run smoke:auth -- <BASE_URL> <demo phone>` exists (T8c, `scripts/smoke-auth.mjs`; it also reads `BASE_URL` and
`SMOKE_PHONE`). It was run against the built app and a scratch database for a staff and a resident phone: 13 of 13 checks
each. It reads nothing secret and changes only demo users' sessions and one-time codes. What it checks (the first list
was the specification; the script also checks `/api/me`, the 30-second refusal and a cross-site `logout-all`):

1. `POST /api/auth/otp/request` with `{ "phone": "5000000006" }` returns 200 and `message: "OTP_SENT_GENERIC"`, and, with
   `DEMO_MODE=true`, a six-digit `demoCode`. With an unknown demo phone the answer has the same shape.
2. A wrong code returns 400 `OTP_NOT_ACCEPTED`.
3. A fresh request and the right code at `/api/auth/otp/verify` return 200 `{ role: "RESIDENT", redirectTo: "/" }`
   and a `Set-Cookie` that starts `__Host-session=` and contains `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and no `Domain`.
4. `5000000001` (staff) returns `redirectTo: "/staff"`.
5. `/api/auth/logout` returns 204 and a cookie with `Max-Age=0`; `/api/auth/logout-all` with no cookie returns 401.
6. `/api/health` returns 200. Every response carries `Cache-Control: no-store`.

By hand, once, after the first deploy:

- **The `pg` question (V5c):** step 3 working is the proof that `pg` is present in the deployed function.
- **The client-IP question (V4c, V8):** make a code request from your laptop and one from a phone on mobile data, then, as the owner,
  `SELECT count(DISTINCT requested_ip_hash) FROM otp_codes;`. Expect at least 2. If it is 1, `VERCEL` is not `1`
  (the System Environment Variables box is not ticked) and everyone shares one limit of 30 requests an hour.
- **The advisory-lock question (N11c):** the complaint-link trigger uses `pg_advisory_xact_lock`. Before the complaints
  feature goes live, a test must run two concurrent link inserts through the **pooled** URL. Until then the lock is
  unverified through the pooler. If it fails, point the app at the direct string (limit 104 connections at 0.25 CU, N9c)
  and keep the Prisma pool small.
- **Cold start:** wait 6 minutes without traffic, then open the site and time the first request. Neon says wake-up is "a few
  hundred milliseconds" (N10); the function also starts cold. Note both numbers.

## Rollback plan

| Problem | Action | Limits |
|---|---|---|
| A bad code deployment | Vercel **Instant Rollback** to the previous production deployment; or Deployments > Create Deployment from an earlier commit SHA (V9b). | On Hobby, rollback reaches only "the immediately previous deployment" (V6 source, rollbacks section). |
| A bad migration | Neon **instant restore** to a time before the migration (Console > Backup & Restore > Restore from history). It overwrites the branch, keeps a backup branch `{branch}_old_{timestamp}`, and keeps the connection details (N14a). | Free keeps only **6 hours** of history. Rows written after the restore point (new sessions, codes) are lost. Migrations are forward-only; do not edit an applied one. |
| The database is lost or too damaged | Create a new Neon project (or branch), run steps 3 to 5 of the procedure, put the new pooled string in Vercel `DATABASE_URL`, redeploy. | The demo data is generated, so this takes minutes; anything entered by hand is lost. Region choice is fixed per project (N13b). |
| A leaked app password | `ALTER ROLE township_app WITH PASSWORD '...'` as the owner, update `DATABASE_URL` in Vercel, redeploy (changes apply only to new deployments, V4a). | Old deployments keep working or failing with the old value until replaced. |
| A leaked or weak `OTP_PEPPER` | Set a new value, redeploy. | Codes in flight (5 minutes) stop working. Sessions are unaffected: session tokens are hashed with plain SHA-256, no pepper (D79). |
| Abuse of the public demo | Kill switch: set `DEMO_MODE=false`, redeploy. Nobody can then get a code, because the mock sender sends nothing. Then reseed if needed. | The site stays up but login is closed. |
| A runaway or failing cron | Project Settings > Cron Jobs > **Disable Cron Jobs** (V6 source). | It stays disabled until you re-enable it. |
| A Neon limit is hit | Compute and transfer: suspended until the next billing period or an upgrade (N9d). Storage: writes fail. Free space by recreating the database from the seed. | No data is deleted by the limits (N9d). |

## What could break us

Likelihood (L) and impact (I) are my judgement: low, medium or high. They are not measured.

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| 1 | **Node 26 instead of 24.** `engines.node ">=24"` maps to the latest 26.x on Vercel (V2). Untested runtime. | high | medium | Decision 8: change to `24.x` before the first deploy. |
| 2 | **`VERCEL` is not exposed**, so `clientIp` returns `unknown` and all visitors share the 30-an-hour address limit; login becomes unusable. | medium | high | Tick "Enable access to System Environment Variables" (checklist); the distinct `ip_hash` check after deploy. |
| 3 | **The app connects as the table owner** (for instance through the Neon-Vercel integration). A compromise could disable the append-only triggers. | medium | high | Separate `township_app` role; no owner string in Vercel; Decision 10; the negative checks. |
| 4 | **`neondb_owner` can set `session_replication_role`** (not found). Irrelevant to the app role, relevant to anyone holding the owner string. | unknown | medium | Keep the owner string on your laptop only; run the checks as the app role. |
| 5 | **Advisory lock through the pooler is unverified** (N11c). A race could create a duplicate-chain in `complaint_links`. | low | high | Concurrency test through the pooled URL before the complaints feature ships; fallback to the direct string. |
| 6 | **Cold start and no connect timeout.** After 5 idle minutes the first query waits for Neon to wake (N10). `src/server/db.ts` sets no connection timeout, so a stuck connection could hold a request until the function times out (300 s). | medium | medium | A later task: set `connectionTimeoutMillis` and a small `max` on the pool, and retry once. Measure the first request. |
| 7 | **Hobby terms:** commercial use, "without notice" shutdown, inactive-account termination, AI-training clause (V1e, V7b, N15b). | low | high | Decisions 1 and 11; no payment features; log in every 2 weeks; keep a seed copy. |
| 8 | **Neon inactivity deletion:** the 90-day rule appears on the Azure deprecation page and on the regions page, but its scope is unclear (N14b). Our 40 to 60 days is under 90. | low | high | Daily cron keeps the project active; check the Neon console each fortnight; the seed re-creates the data. |
| 9 | **A Neon Free limit is reached:** 1 GB storage, 100 CU-hours, 5 GB transfer (N9a). `audit_log` and `otp_codes` grow with every login and request; a stranger can add rows (30 requests an hour per address). | medium | medium | Read the size the seed prints; check the console weekly; a later task purges expired codes and sessions (needs DELETE, so a deliberate grant). |
| 10 | **Cron runs late, twice or not at all** (V6). | high | low | Idempotent jobs; the manual "run daily jobs" button. |
| 11 | **Demo login is open to strangers** when `DEMO_MODE=true`. | high | medium | Fictional data only; `DEMO_MODE=false` kill switch; rate limits; reseed. |
| 12 | **Deploy blocked: the commit author is not the Hobby team owner** (V9b). | medium | medium | Link the commit e-mail to your GitHub account; or deploy with the Vercel CLI. |
| 13 | **The Production Branch is not `master`**, so the first push makes only a preview, with no variables (V9b). | low | medium | Check Environments > Production > Branch Tracking. |
| 14 | **A preview deployment reaches a real database.** | low | high | `DATABASE_URL` is Production-only (Decision 4). |
| 15 | **A secret reaches the chat or a commit.** | medium | high | The checklist's "never paste" list; `npm run scan:secrets`; the Secret type in Vercel. |
| 16 | **Seed run against the wrong database.** | low | high | The seed's guards (`--allow-remote`, `--confirm-database`), the printed `Target` line, and a fresh shell. |
| 17 | **Logs vanish:** Hobby keeps runtime logs 1 hour (V1b). | high | low | Look at logs right after each deploy; the durable record is `audit_log`. |
| 18 | **Body limit 4.5 MB** (V1b): a large bank-statement upload would be refused. | low | medium | The 5,000-row benchmark statements are far smaller; keep uploads small. |
| 19 | **Docs change** after 2026-11-06 (the pages move fast; Cron Jobs are called legacy). | medium | low | Re-read the "not found" list and V1, V6, N9, N14 before deploying. |
| 20 | **A vulnerable Next.js version is blocked at deploy** (a Vercel changelog item named in V4's page links). | low | medium | Keep Next.js patched; read the build log. |
| 21 | **Connection pool size** under many function instances. | low | low | Use the pooler (10,000 clients, N11a); keep the app pool small. |
| 22 | **Prisma and Postgres versions differ** from local (Postgres 16 here; Neon's version not found). | low | medium | The integration tests run on 16; run `prisma migrate status` and the smoke test on Neon; note the version in the console. |

## Sources fetched on 2026-11-06

Vercel: `vercel.com/docs/plans/hobby`, `/docs/limits`, `/docs/functions/limitations`,
`/docs/functions/runtimes/node-js/node-js-versions`, `/docs/functions/configuring-functions/region`, `/docs/regions`,
`/docs/environment-variables`, `/docs/environment-variables/system-environment-variables`,
`/docs/builds/configure-a-build`, `/docs/frameworks/full-stack/nextjs`, `/docs/cron-jobs`,
`/docs/cron-jobs/usage-and-pricing`, `/docs/cron-jobs/manage-cron-jobs`, `/docs/limits/fair-use-guidelines`,
`/docs/deployment-protection`, `/docs/accounts`, `/docs/git`, `/docs/headers/request-headers`, `/pricing`,
`/legal/terms`, `/kb/guide/why-is-my-account-deployment-blocked`; and a search of vercel.com for `.nvmrc`.

Neon: `neon.com/docs/introduction/plans`, `/docs/introduction/scale-to-zero`, `/docs/connect/connection-pooling`,
`/docs/guides/prisma`, `/docs/manage/roles`, `/docs/introduction/regions`, `/docs/introduction/branch-restore`,
`/docs/guides/vercel-managed-integration`, `/docs/import/azure-regions-deprecation`, `/faqs/free-plan-limits-and-quotas`,
`/docs/get-started/signing-up`, `/terms-of-service`; and a search of neon.com about inactive Free projects.

Others: `www.prisma.io/docs/orm/prisma-client/deployment/serverless/deploy-to-vercel`, `www.pgbouncer.org/features.html`,
`www.postgresql.org/docs/current/sql-altertable.html`, `/runtime-config-client.html`, `/ddl-priv.html`.

Local evidence (no hosted service involved): `npm ls pg --omit=dev`; `prisma generate` in a copy of the repository
with no `.env` and no `DATABASE_URL`; `prisma/schema.prisma` and the migrations for the table and trigger list.
