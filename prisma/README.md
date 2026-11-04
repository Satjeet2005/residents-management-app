# prisma

Prisma schema and migrations (Prisma 7, driver adapter `@prisma/adapter-pg`, config in `prisma.config.ts`).

- Tables and columns are snake_case in SQL (`@@map` / `@map`). Money is `BIGINT` paise; calendar dates are `DATE`.
- Create a migration with `npx prisma migrate dev --create-only --name <name>`, then hand-edit the SQL. Never use `db push`.
- Constraints Prisma cannot express (CHECKs, the partial unique index on unresolved payment attempts, the append-only ledger trigger) are written by hand in the migration SQL and proven by `tests/integration/*`.
- The generated client goes to `generated/prisma` (git-ignored); `npm install` and `npm run db:generate` rebuild it.
