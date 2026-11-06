# Deploy checklist (for the human)

This is the list you follow in the Vercel and Neon consoles and in your own terminal. It goes with
`docs/deployment-plan.md`, which explains why. Nothing here has been run: the agent has not created an account,
deployed anything, or touched Vercel or Neon.

Each step has an **Expected** line. If what you see differs, stop and tell the agent what you saw (never the secret
itself), and do not "fix" it by trying other things.

Console menus change. Where a label below comes from a vendor page, the page is named. If a label is not where it
says, use the page named or the console search, and tell the agent so the checklist can be corrected.

## The one rule about secrets

The agent must never see a secret. You type or paste secrets only into the **Vercel dashboard**, the **Neon console**,
**your own terminal prompt**, or your **password manager**.

| Safe to paste into the agent's chat | NEVER paste (not even partly, not in a screenshot) |
|---|---|
| The production URL (`https://<project>.vercel.app`) | Any string starting `postgresql://` or `postgres://`, with or without a password |
| Region names, Node version, the plan name | The password of `township_app` or `neondb_owner` |
| The `Target: host ..., database ...` line the seed prints (host and database only) | `OTP_PEPPER`, `CRON_SECRET`, `LLM_API_KEY`, any API or Vercel token |
| Output of the check queries (role names, table names, `permission denied` lines) | The contents of `.env`, or a screenshot of an Environment Variables form with values showing |
| Build-log lines, after you scan them for the strings in the right-hand column | A session cookie value, or a copied `Set-Cookie` header |
| "A card was requested at step N" or any error text without a credential in it | A Neon "Connect" dialog, which shows a full connection string |

If you pasted a secret by mistake: treat it as leaked. Rotate it (plan, "Rollback plan"), and say so in the chat.

Generate secrets on your machine and keep them in your password manager. Do not copy them into a file in the repository.

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # for OTP_PEPPER (64 characters)
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"         # for CRON_SECRET (48 letters and digits)
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"   # for the township_app password (32 characters)
```

## Part 0. Before you start

- [ ] You have answered the **Decisions for the human** in `docs/deployment-plan.md`, above all 1 (is Hobby allowed for
      this work), 7 (demo mode on a public URL), 8 (Node version) and 11 (Hobby content terms). **Expected:** each has an
      answer written in the chat.
- [ ] `engines.node` is `24.x` (Decision 8, done in T9b) and `npm run smoke:auth` exists (T8c). **Expected:** both are in `package.json`. The agent's tests prove the database grants, but you still run C4 and C8 on Neon.
- [ ] You have a password manager open and a terminal in the project folder, with Node 24 (`node -v` prints `v24.`).
- [ ] If any sign-up below asks for a **payment card**, stop. The plan assumes none is needed, and the vendor pages did
      not confirm that either way (plan, "Things this research could not establish", item 1). Tell the agent at which
      step it appeared. Do not enter a card.

## Part A. Accounts

### A1. Neon

- [ ] Go to https://neon.com and sign up (the docs do not say which methods exist; use the one on the page).
      **Expected:** you reach the Neon Console, on the **Free** plan, with no payment step.
- [ ] Note the plan name shown in the console. **Expected:** "Free".

### A2. Vercel

- [ ] Go to https://vercel.com and use **Sign Up** (the exact address was not checked) to sign up with the **GitHub account that owns the repository** (the repository is
      `Satjeet2005/residents-management-app`). The Vercel docs say Hobby sign-up is by email or by a Git provider
      (https://vercel.com/docs/accounts). Choose a **Hobby** (personal) team, not a team that needs Pro.
      **Expected:** the dashboard opens with a Hobby team and no payment step.
- [ ] Open Account Settings > Authentication. **Expected:** your GitHub login is listed. (A Hobby team deploys a commit only if
      its author is the team owner, matched through this login: https://vercel.com/docs/git.)
- [ ] On GitHub, Settings > Emails: **Expected:** the e-mail used in your commits (`git log -1 --format=%ae`) is listed and
      verified on your GitHub account. If it is not, add it, or Vercel may block the deployment.

## Part B. The Neon project

- [ ] In the Neon Console, create a project. **Name:** `township-demo`. **Region:** **AWS Asia Pacific 1 (Singapore)**,
      `aws-ap-southeast-1`. Keep database name `neondb`. **Expected:** the project page opens; the region shows Singapore.
      You **cannot change the region later** (https://neon.com/docs/introduction/regions).
- [ ] Note the Postgres version the console shows. **Expected:** a number such as 16, 17 or 18. Tell the agent the number
      (it is not secret). The plan could not find the default.
- [ ] Open **Connect**. Turn **Connection pooling off**, choose role `neondb_owner`, database `neondb`, and copy the string
      into your **password manager** as "neon-owner-direct". Do **not** paste it into the chat.
      **Expected:** the host has **no** `-pooler` in it.
- [ ] Turn **Connection pooling on** and copy that string into the password manager as "neon-owner-pooled". You will use
      only its **host**; you will not use the owner in Vercel. **Expected:** the host has `-pooler` in it.

## Part C. Migrate, create the app role, seed (your terminal)

Do these in order, in one terminal, on your laptop, in **bash** (the `read -rs` form below is bash; in zsh use `read -s`).
The owner string is used here and nowhere else. The checks in C8 need a Postgres client such as `psql`; if you do not
have one, tell the agent, who can write a small check script that reads the string from a prompt (`pg` is already
installed).

- [ ] **C1. Enter the owner string without showing it.**
      ```bash
      read -rs DATABASE_URL && export DATABASE_URL        # paste "neon-owner-direct", press Enter
      node -e 'const u=new URL(process.env.DATABASE_URL); console.log(u.hostname, u.pathname)'
      ```
      **Expected:** a host ending `.neon.tech` with no `-pooler`, then `/neondb`. (A value set in the shell wins over `.env`;
      the plan records that this was tested with Node 24.15.0.)
- [ ] **C2. Migrate.**
      ```bash
      npx prisma migrate deploy
      npx prisma migrate status
      ```
      **Expected:** every migration applied, then "Database schema is up to date!". If it fails with a connection or
      lock error, you are probably on the pooled string: repeat C1 with the direct one.
- [ ] **C3. Create the app role, with SQL (not in the Neon console).** A role made in the console, API or CLI becomes a member of
      `neon_superuser` and the grants script will refuse it. In the Neon **SQL Editor** (or `psql "$DATABASE_URL"`), run the single
      `CREATE ROLE township_app WITH LOGIN NOSUPERUSER ...` statement from `docs/deployment-plan.md`, "Creating the role and applying
      the grants", step 1. Then set the password: in `psql`, `\password township_app` (a prompt); in the SQL Editor,
      `ALTER ROLE township_app WITH PASSWORD '<value>'` with the 32-character value you generated, and save that value in the password
      manager as "township_app password". **Expected:** `CREATE ROLE` and the password statement succeed. If the role already exists, tell the agent.
- [ ] **C3b. Print and run the grants.** On your laptop:
      `npm run db:print-app-role-sql -- --app=township_app --owner=neondb_owner > app-role.sql`. **Expected:** a file of about 60 lines
      that starts with `-- Grants for the application role "township_app"`, with no password in it. Read it. Then, with the owner string
      still in `DATABASE_URL`, run `psql "$DATABASE_URL" -f app-role.sql` (or paste it into the SQL Editor). **Expected:** it finishes
      without an error. If it stops with a message ("Run this as the owner role", "does not exist", "administrator attributes",
      "neon_superuser", "owns a table", "No privilege decision"), do not work around it: tell the agent the message. Delete `app-role.sql` afterwards.
- [ ] **C5. Seed.**
      ```bash
      export DEMO_MODE=true
      npm run db:seed -- --yes --allow-remote --confirm-database=neondb
      ```
      **Expected:** the first line reads `Target: host <endpoint>.neon.tech, database neondb`; then a table of row counts
      (2,400 flats, 3,434 users) and `Database size: ... MB`. Paste the Target line and the size to the agent. If the size is above
      about 700 MB, tell the agent before going on (the Free cap is 1 GB).
- [ ] **C6. Clear the terminal's secrets.**
      ```bash
      unset DATABASE_URL DEMO_MODE
      ```
      **Expected:** `echo "${DATABASE_URL:-unset}"` prints `unset`.
- [ ] **C7. Build the app's connection string**, in the password manager, from "neon-owner-pooled": keep everything but
      replace the user with `township_app` and the password with the "township_app password". Keep `?sslmode=require`
      at the end. Save it as "neon-app-pooled". **Expected:** the host still has `-pooler`; the user is `township_app`.
- [ ] **C8. Prove the app role is limited.** In a new terminal, connect with "neon-app-pooled" (`read -rs APP_URL`, then
      `psql "$APP_URL"`) and run the seven statements from the plan's "Checks". **Expected:** every one is refused (permission
      denied, or "must be owner"). If **any** succeeds, stop and tell the agent which one, not the string. Then `unset APP_URL`.

## Part D. The Vercel project

- [ ] **D1. Import the repository.** Dashboard > Add New > Project > import `Satjeet2005/residents-management-app`.
      Framework preset: **Next.js** (detected). Do **not** press Deploy yet: first set the variables below (Environment
      Variables is on the same screen). **Expected:** the project settings screen shows Framework "Next.js".
- [ ] **D2. Environment variables.** For each row, click Add, type the **Key**, paste the **Value** from your password
      manager, choose **Production only** (untick Preview and Development), and set the type to **Secret** where marked
      (https://vercel.com/docs/environment-variables). **Expected:** the list shows each name with a lock for secrets and
      "Production" as its only environment.

      | Key | Value | Type |
      |---|---|---|
      | `DATABASE_URL` | "neon-app-pooled" | Secret |
      | `OTP_PEPPER` | the 64-character value you generated | Secret |
      | `DEMO_MODE` | `true` (Decision 7) or `false` | Config |
      | `SHOW_DESIGN_PAGE` | `false` | Config |

      Do **not** add `DATABASE_URL_UNPOOLED`, the owner string, `SESSION_SECRET` (unused), `LLM_API_KEY` (not yet) or `DEMO_AS_OF` (optional, for local use only: leave it unset so the live dues use the real date, D97).
      Add `CRON_SECRET` only when the cron route is built.
- [ ] **D3. Expose system variables.** On the same Environment Variables page tick **"Enable access to System Environment
      Variables"** (https://vercel.com/docs/environment-variables/system-environment-variables). **Expected:** the box is ticked
      and saved. Without it `VERCEL` is not `1` and the address limit breaks (plan, risk 2).
- [ ] **D4. Node version.** Settings > Build and Deployment > Node.js Version. **Expected:** **24.x**. (`engines` in
      `package.json` overrides this, which is why it was changed in Part 0.)
- [ ] **D5. Function region.** Settings > Functions > Function Regions > **Singapore (`sin1`)**
      (https://vercel.com/docs/functions/configuring-functions/region). Hobby allows one region. **Expected:** only `sin1`
      is selected.
- [ ] **D6. Production branch.** Settings > Environments > Production > Branch Tracking. **Expected:** `master`
      (https://vercel.com/docs/git#production-branch). If it shows another name, change it to `master` and save.
- [ ] **D7. Deployment Protection.** Settings > Deployment Protection. **Expected:** you can see which scope is selected.
      For a reviewer with no Vercel account, the **production** domain must not be protected: "Standard Protection" leaves
      production public and protects previews (https://vercel.com/docs/deployment-protection). Do not turn on "All Deployments".
      Tell the agent which scope it shows (the default was not found in the docs).
- [ ] **D8. Cron.** Leave it for now: the cron route is not built. **Expected:** Settings > Cron Jobs lists none.
- [ ] **D9. Deploy.** Press Deploy (or push to `master` once linked). **Expected:** the build finishes; the log shows
      `prisma generate` ran at install and `next build` listed the four `/api/auth/...` routes and `/api/health`. Open
      the deployment's Build Logs and check that the Node version it reports is 24. Scan the log for `postgresql://`
      before pasting any part of it.
- [ ] **D9b. If the build is blocked** with a message about the commit author or the team, see Part A2; if it says
      "`prisma: command not found`", tell the agent (the plan's fix is to move `prisma` to dependencies, a code change).

## Part E. Check the live site

Put the address in your shell, then run the agent's smoke script:

```bash
export BASE_URL=https://<your-project>.vercel.app
npm run smoke:auth -- "$BASE_URL" 5000000006     # a resident; then repeat with 5000000001 (staff)
```

- [ ] **E1. Smoke test.** **Expected:** every step prints OK (request returns the generic answer; a wrong code is refused;
      the right code logs in a resident and a staff user; the cookie is `__Host-session` with `Secure`, `HttpOnly`,
      `SameSite=Lax`; logout returns 204). Paste the printed summary. If the function says "Cannot find module 'pg'", tell the
      agent (plan, Decision 9).
- [ ] **E2. Health.** Open `$BASE_URL/api/health` in a browser. **Expected:** `{"status":"ok"}`.
- [ ] **E3. Two networks.** Request a code once from your laptop and once from your phone on mobile data (use the smoke script
      or the README `curl` commands). Then, as the owner (Part C1 again), run
      `SELECT count(DISTINCT requested_ip_hash) FROM otp_codes;` **Expected:** at least 2. If 1, repeat D3 and redeploy, then retry.
      Run `unset DATABASE_URL` after.
- [ ] **E4. Cold start.** Wait 6 minutes without opening the site, then load the home page and note how long it takes.
      Tell the agent the time. **Expected:** slower than usual, but it loads (Neon wakes in "a few hundred milliseconds" and
      the function starts cold).
- [ ] **E5. A stranger's view.** Open the production URL in a private window, not logged in to Vercel. **Expected:** the site
      loads without a Vercel login page. If a Vercel login page appears, go back to D7.
- [ ] **E6. Logs.** Open the deployment's runtime logs and look for errors. **Expected:** none. (Hobby keeps logs for **1 hour**.)

## Part F. Keep it alive for the review window

- [ ] Put a reminder every **14 days** to open the Vercel dashboard and the Neon Console, and to open the live site.
      **Expected:** the project still exists, the database is not suspended past its 5-minute idle sleep, and the usage
      pages show you are inside the Free limits. The plan could not find the inactivity thresholds
      (plan, "Things this research could not establish", items 2 and 3).
- [ ] In the Neon Console check **storage** (limit 1 GB) and **CU-hours** (limit 100 a month) weekly. **Expected:** both far
      below the limit. Do **not** keep the database awake by pinging it: that would use the month's compute hours in about
      17 days (plan, Decision 6).
- [ ] Keep the seed command and your password manager entries. If the database is lost, Part C rebuilds it in minutes.

## Part G. If something goes wrong, or when the review is over

- [ ] **Close the demo login at once:** Vercel > Settings > Environment Variables > `DEMO_MODE` > `false`, then redeploy.
      **Expected:** the next code request no longer returns a `demoCode`, and nobody can sign in.
- [ ] **Roll back the code:** Deployments > the previous production deployment > Instant Rollback (Hobby: only the immediately
      previous one). **Expected:** the live site returns to that version.
- [ ] **Restore the database:** Neon Console > Postgres database > Backup & Restore > Restore from history, within 6 hours.
      **Expected:** a backup branch named `<branch>_old_<time>` appears, and the connection details do not change.
- [ ] **Take it all down after the review:** delete the Vercel project (Settings > General), then delete the Neon project.
      **Expected:** the live address stops working. Remove the password manager entries for the secrets of this project.
