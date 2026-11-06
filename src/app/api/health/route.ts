import { publicRoute } from "@/server/auth/guard";

export const GET = publicRoute(() => Response.json({ status: "ok" }));
