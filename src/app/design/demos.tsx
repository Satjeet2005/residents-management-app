"use client";

import { useState } from "react";
import { BlockError } from "@/components/ui/block-error";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";

/** The parts of the showcase that need a click handler, so they live in a client component. */
export function SheetDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outlined" onClick={() => setOpen(true)}>
        Open the sheet
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Pay maintenance"
        footer={
          <Button size="large" onClick={() => setOpen(false)}>
            Pay now
          </Button>
        }
      >
        <p>This body scrolls when it is taller than the sheet. The footer stays at the bottom.</p>
        {Array.from({ length: 12 }, (_, i) => (
          <p key={i} className="mt-3 text-ink-2">
            Line {i + 1} of placeholder text to make the body scroll.
          </p>
        ))}
      </Sheet>
    </>
  );
}

export function BlockErrorDemo() {
  const [tries, setTries] = useState(0);
  return (
    <div className="flex flex-col gap-2">
      <BlockError message="We could not load your bills." consequence="You can't pay right now." onRetry={() => setTries(tries + 1)} />
      <p className="text-caption text-ink-2">Try again pressed {tries} times.</p>
    </div>
  );
}
