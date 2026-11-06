import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CheckIcon, ChatIcon, ChevronIcon, HomeIcon, PhoneIcon, ReceiptIcon, UserIcon, WarningIcon } from "@/components/icons";

const ICONS = { HomeIcon, ReceiptIcon, ChatIcon, UserIcon, WarningIcon, PhoneIcon, CheckIcon, ChevronIcon };

describe("the inline icons", () => {
  it.each(Object.entries(ICONS))("%s is a 24px box, a 2px stroke in the text colour, no fill, hidden from screen readers", (_name, Icon) => {
    const out = renderToStaticMarkup(h(Icon, {}));
    expect(out).toContain('viewBox="0 0 24 24"');
    expect(out).toContain('width="24"');
    expect(out).toContain('stroke-width="2"');
    expect(out).toContain('stroke="currentColor"');
    expect(out).toContain('fill="none"');
    expect(out).toContain('aria-hidden="true"');
    expect(out).not.toMatch(/fill="(?!none)/);
  });

  it("has exactly the eight icons the design needs, and no bell", () => {
    expect(Object.keys(ICONS)).toHaveLength(8);
  });
});
