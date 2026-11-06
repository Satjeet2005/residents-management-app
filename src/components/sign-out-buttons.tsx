"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { t } from "@/lib/messages";
import { Button } from "./ui/button";
import { Notice } from "./ui/notice";

type Busy = "NONE" | "ONE" | "ALL";

/** Sign out here, or on every device (POST /api/auth/logout and /logout-all), then go to /login. */
export function SignOutButtons({ showAll }: { showAll: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>("NONE");
  const [failed, setFailed] = useState(false);

  async function signOut(path: string, which: Busy) {
    setBusy(which);
    setFailed(false);
    try {
      const response = await fetch(path, { method: "POST" });
      if (response.status === 204 || response.status === 401) {
        router.replace("/login");
        router.refresh();
        return;
      }
      setFailed(true);
    } catch {
      setFailed(true);
    }
    setBusy("NONE");
  }

  return (
    <div className="flex flex-col gap-2">
      {failed && <Notice kind="alert">{t("profile.signOutError")}</Notice>}
      <Button variant="outlined" loading={busy === "ONE"} loadingLabel={t("profile.signingOut")} disabled={busy !== "NONE"} onClick={() => signOut("/api/auth/logout", "ONE")}>
        {t("profile.signOut")}
      </Button>
      {showAll && (
        <Button variant="outlined" loading={busy === "ALL"} loadingLabel={t("profile.signingOut")} disabled={busy !== "NONE"} onClick={() => signOut("/api/auth/logout-all", "ALL")}>
          {t("profile.signOutAll")}
        </Button>
      )}
    </div>
  );
}
