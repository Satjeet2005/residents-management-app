"use client";

import { Notice } from "@/components/ui/notice";
import { t } from "@/lib/messages";
import { useOnline } from "@/lib/use-online";

/** Design state O: at the top of the Home, in words, while the browser is offline. Pay is then the dashed, disabled control (see PayControl). */
export function OfflineBanner() {
  return useOnline() ? null : <Notice>{t("offline.banner")}</Notice>;
}
