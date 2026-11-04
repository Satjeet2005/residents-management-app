# src/server

Orchestrates `src/domain` and Prisma. Every route handler and server action goes through `withPermission(permission, handler)`. Inputs are validated with zod.
