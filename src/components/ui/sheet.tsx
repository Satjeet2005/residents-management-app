"use client";

import { type MouseEvent, type ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "./button";

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
};

/**
 * A modal sheet on the native <dialog> element: showModal() gives the focus trap,
 * the backdrop, Escape to close and inert page behind. Focus goes back to the
 * element that opened it. Opens from the bottom at 360px and is centred when wide.
 */
export function Sheet({ open, onClose, title, children, footer, hideClose = false }: SheetProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) {
      opener.current = document.activeElement;
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  const handleClose = () => {
    if (opener.current instanceof HTMLElement) opener.current.focus();
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
      className="m-0 mt-auto max-h-[90dvh] w-full max-w-none flex-col rounded-t-sheet border border-hairline bg-paper p-0 text-ink backdrop:bg-ink/50 open:flex sm:m-auto sm:max-w-lg sm:rounded-sheet"
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
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
      {footer !== undefined && <div className="sticky bottom-0 border-t border-hairline bg-paper px-4 py-3">{footer}</div>}
    </dialog>
  );
}
