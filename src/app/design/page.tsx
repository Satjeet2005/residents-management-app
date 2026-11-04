import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { LedgerLine } from "@/components/ui/ledger-line";
import { LedgerTotal } from "@/components/ui/ledger-total";
import { Money } from "@/components/ui/money";
import { Notice } from "@/components/ui/notice";
import { DoubleRule, Hairline } from "@/components/ui/rules";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusTag } from "@/components/ui/status-tag";
import { Tracker } from "@/components/ui/tracker";
import { BlockErrorDemo, SheetDemo } from "./demos";

export const metadata = { title: "Design" };

/** Read at request time, so turning the page on or off needs no rebuild. */
export const dynamic = "force-dynamic";

const SWATCHES = [
  { name: "paper", use: "ground", classes: "bg-paper text-ink border border-hairline" },
  { name: "paper-2", use: "chips, placeholders", classes: "bg-paper-2 text-ink border border-hairline" },
  { name: "ink", use: "text, rule", classes: "bg-ink text-paper" },
  { name: "ink-2", use: "secondary text", classes: "bg-ink-2 text-paper" },
  { name: "accent", use: "action, tracker, links", classes: "bg-accent text-white" },
  { name: "caution", use: "overdue, warnings", classes: "bg-caution text-white" },
  { name: "control", use: "outlined controls", classes: "bg-control text-white" },
  { name: "hairline", use: "ruled lines", classes: "bg-hairline text-ink" },
];

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-title font-semibold">{title}</h2>
      <Hairline />
      {children}
    </section>
  );
}

const Row = ({ children }: { children: ReactNode }) => <div className="flex flex-wrap items-center gap-2">{children}</div>;

export default function DesignPage() {
  if (process.env.SHOW_DESIGN_PAGE !== "true") notFound();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-heading font-semibold">Design system</h1>
        <p className="text-ink-2">Every component and state, in the Passbook design. This page exists only while SHOW_DESIGN_PAGE is true.</p>
        <DoubleRule />
      </header>

      <Block title="Colour">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SWATCHES.map((s) => (
            <li key={s.name} className={`flex min-h-20 flex-col justify-end rounded-control p-2 text-caption ${s.classes}`}>
              <span className="font-semibold">{s.name}</span>
              <span>{s.use}</span>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Type">
        <p className="text-caption">Caption 14/21: Maintenance for October</p>
        <p className="text-body">Body 16/24: Maintenance for October is due on the 10th.</p>
        <p className="text-title font-semibold">Title 20/30: Amount due</p>
        <p className="text-heading font-semibold">Heading 24/36: Your account</p>
        <p className="text-hero font-semibold">Hero 40/48</p>
      </Block>

      <Block title="Buttons">
        <Row>
          <Button>Primary</Button>
          <Button variant="outlined">Outlined</Button>
          <Button variant="link">Link</Button>
        </Row>
        <Row>
          <Button disabled>Disabled</Button>
          <Button variant="outlined" disabled>
            Disabled outlined
          </Button>
          <Button loading loadingLabel="Paying">
            Pay
          </Button>
        </Row>
        <Button size="large">Pay ₹6,468 (large, 56px)</Button>
        <Button size="large" disabled>
          Pay (large, disabled)
        </Button>
      </Block>

      <Block title="Status tags">
        <Row>
          <StatusTag>Pending</StatusTag>
          <StatusTag tone="caution" icon="!">
            Overdue by 17 days
          </StatusTag>
          <StatusTag tone="positive" icon="✓">
            Paid
          </StatusTag>
        </Row>
      </Block>

      <Block title="Rules">
        <p className="text-caption text-ink-2">Hairline</p>
        <Hairline />
        <p className="text-caption text-ink-2">Double rule</p>
        <DoubleRule />
      </Block>

      <Block title="Money">
        <Money amount={646800n} size="hero" />
        <Money amount={12345600n} size="large" />
        <Money amount={98430n} />
      </Block>

      <Block title="Ledger">
        <ul className="m-0 list-none p-0">
          <LedgerLine date="05 Jun" particulars="Maintenance, June" amount={637000n} />
          <Hairline />
          <LedgerLine date="05 Aug" particulars="Maintenance, August, paid by UPI with a long note that wraps" amount={637000n} />
          <Hairline />
          <LedgerLine date="10 Sep" particulars="Late fee" amount={9800n} />
        </ul>
        <LedgerTotal label="Amount due" amount={646800n} />
      </Block>

      <Block title="Tracker">
        <Tracker steps={[{ label: "Payment started", state: "done" }, { label: "Bank confirming", state: "current" }, { label: "Posted to your account", state: "upcoming" }]} />
        <Tracker
          steps={[
            { label: "Raised", state: "done" },
            { label: "Assigned", state: "done" },
            { label: "In progress, a longer label that wraps", state: "current" },
            { label: "Closed", state: "upcoming" },
          ]}
        />
        <Tracker steps={[{ label: "Raised", state: "done" }, { label: "Assigned", state: "done" }, { label: "Closed", state: "done" }]} />
      </Block>

      <Block title="Section header">
        <SectionHeader title="Recent complaints" action={{ label: "See all", href: "/design" }} />
        <SectionHeader title="Notices" />
      </Block>

      <Block title="Sheet">
        <SheetDemo />
      </Block>

      <Block title="Skeleton">
        <Skeleton lines={4} />
      </Block>

      <Block title="Block error">
        <BlockErrorDemo />
      </Block>

      <Block title="Notices">
        <Notice>You are offline. Showing what we last saved.</Notice>
        <Notice kind="alert">Your payment could not be confirmed. Do not pay again until we tell you.</Notice>
      </Block>

      <Block title="Hindi and Marathi">
        <p className="text-caption text-ink-2">Placeholder translation, not reviewed. Rendering test only: line height 1.6, no capitals, no letter-spacing.</p>
        <div lang="hi" className="flex flex-col gap-3">
          <p className="text-caption">हिन्दी (placeholder translation, not reviewed)</p>
          <p className="text-heading font-semibold">देय राशि</p>
          <p className="text-body">विलंब शुल्क</p>
          <Row>
            <Button>भुगतान करें</Button>
            <Button variant="outlined">शिकायत दर्ज करें</Button>
          </Row>
          <Row>
            <StatusTag tone="caution">आपातकाल</StatusTag>
          </Row>
          <ul className="m-0 list-none p-0">
            <LedgerLine date="05 Aug" particulars="देय राशि" amount={637000n} />
          </ul>
        </div>
        <div lang="mr" className="flex flex-col gap-3">
          <p className="text-caption">मराठी (placeholder translation, not reviewed)</p>
          <p className="text-heading font-semibold">देय रक्कम</p>
          <p className="text-body">विलंब शुल्क</p>
          <Row>
            <Button>भरा</Button>
            <Button variant="outlined">तक्रार नोंदवा</Button>
          </Row>
          <Row>
            <StatusTag tone="caution">आणीबाणी</StatusTag>
          </Row>
          <ul className="m-0 list-none p-0">
            <LedgerLine date="05 Aug" particulars="देय रक्कम" amount={637000n} />
          </ul>
        </div>
      </Block>
    </main>
  );
}
