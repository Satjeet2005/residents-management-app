"use client";

import { type MouseEvent, type ReactNode, useEffect, useId, useRef } from "react";
import { lockScroll } from "@/lib/scroll-lock";
import { Button } from "./button";
import { cx } from "./cx";

export type SheetProps = {
  open: boolean;
  /** Called when the sheet closes by Close, Escape or a tap on the backdrop. */
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Stays at the bottom while the body scrolls, for the main action. */
  footer?: ReactNode;
  /** Leave out the Close button of the header, when the footer has the one button that closes it (a sheet whose choices apply at once). */
  hideClose?: boolean;
  /** Where it opens on a phone: from the bottom (default), or from the top when what matters most must be on the first screen (the Emergency sheet, D185). */
  fromTop?: boolean;
};

/**
 * A modal sheet on the native <dialog> element: showModal() gives the focus trap,
 * the backdrop, Escape to close and inert page behind. Focus goes back to the
 * element that opened it. Opens from the bottom at 360px and is centred when wide. While it is open the page behind does not scroll
 * (one reference-counted lock, src/lib/scroll-lock.ts, released on close, Escape and unmount, which is also what a route change does to the page that holds the sheet) and the sheet's own
 * scroll never chains to the page (overscroll-behavior: contain, a body no taller than the dynamic viewport less the header).
 */
export function Sheet({ open, onClose, title, children, footer, hideClose = false, fromTop = false }: SheetProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const release = useRef<(() => void) | null>(null);
  const titleId = useId();

  const unlock = () => {
    release.current?.();
    release.current = null;
  };

  useEffect(() => unlock, []);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) {
      opener.current = document.activeElement;
      element.showModal();
      if (release.current === null) release.current = lockScroll();
    } else if (!open && element.open) {
      element.close();
      unlock();
    }
  }, [open]);

  const handleClose = () => {
    unlock();
    if (opener.current instanceof HTMLElement) opener.current.focus({ preventScroll: true });
    onClose();
  };

  /** A tap on the backdrop lands on the <dialog> itself, not on its content. */
  const handleBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={handleClose}
      onClick={handleBackdrop}
      className={cx(fromTop ? "mb-auto mt-0 rounded-b-sheet border-t-0" : "mt-auto rounded-t-sheet", "m-0 max-h-[calc(100dvh-3.5rem)] w-full max-w-none flex-col border border-hairline bg-paper p-0 text-ink backdrop:bg-ink/50 open:flex sm:m-auto sm:max-w-lg sm:rounded-sheet")}
    >
      <div className="flex items-center justify-between gap-4 border-b border-hairline px-4 py-3">
        <h2 id={titleId} className="text-title font-semibold">
          {title}
        </h2>
        {!hideClose && (
          <Button variant="outlined" onClick={() => dialog.current?.close()}>
            Close
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
      {footer !== undefined && <div className="sticky bottom-0 border-t border-hairline bg-paper px-4 py-3">{footer}</div>}
    </dialog>
  );
}
