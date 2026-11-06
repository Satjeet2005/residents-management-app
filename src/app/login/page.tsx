import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/current-user";
import { safeReturnPath } from "@/server/auth/return-url";
import { isDemoMode } from "@/server/clock";
import { LoginScreen } from "./login-screen";

export const metadata = { title: "Log in" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** A public page: whoever is not signed in logs in here. A signed-in person is sent on to where they were going. */
export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = (await searchParams).returnTo;
  const requested = Array.isArray(raw) ? raw[0] : raw;
  const returnTo = requested === undefined ? null : safeReturnPath(requested);
  const user = await getCurrentUser();
  if (user !== null) redirect(user.role === "STAFF" ? "/staff" : (returnTo ?? "/"));
  return <LoginScreen returnTo={returnTo === "/" ? null : returnTo} showDemoNote={isDemoMode()} />;
}
