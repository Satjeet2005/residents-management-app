FACTS ONLY. The human writes the narrative and the reasoning.

# Screens

Routes from `find src/app -name page.tsx` (2026-11-09). Sizes are from the files in `docs/screenshots`. The committee-choose screenshots show the retired Choose sections sheet (D194) and are historical.

| Route | Role | Purpose | Screenshot | Design document |
|---|---|---|---|---|
| `/login` | public | one-time code login | `docs/screenshots/login-idle-1280.png` (41 KB), `docs/screenshots/login-idle-360.png` (32 KB) | `docs/auth-design.md` |
| `/forbidden` | any signed-in | refusal page | none | `docs/auth-design.md` |
| `/ (Home)` | resident | dues, alerts and the Emergency control | `docs/screenshots/home-overdue-1280.png` (53 KB), `docs/screenshots/home-overdue-360.png` (46 KB) | `docs/design-system.md` |
| `/complaints, /complaints/new, /complaints/[id]` | resident | raise and follow a complaint | `docs/screenshots/complaint-new-empty-1280.png` (26 KB), `docs/screenshots/complaint-new-empty-360.png` (22 KB) | `docs/complaints-ui.md` |
| `/profile` | resident | profile and sign out | `docs/screenshots/profile-swati-1280.png` (42 KB), `docs/screenshots/profile-swati-360.png` (35 KB) | `docs/design-system.md` |
| `/pay/mock/[attemptId]` | demo | demo payment checkout | `docs/screenshots/pay-demo-page-1280.png` (24 KB), `docs/screenshots/pay-demo-page-360.png` (23 KB) | `docs/payments-design.md` |
| `/staff` | staff | staff home with role title and counts | `docs/screenshots/staff-home-after-priya-1280.png` (30 KB), `docs/screenshots/staff-home-after-priya-360x800.png` (27 KB) | `docs/ui-audit-staff-home.md` |
| `/staff/complaints and /staff/complaints/[id]` | complaints:manage | board and complaint page | `docs/screenshots/staff-complaints-board-1280.png` (217 KB), `docs/screenshots/staff-complaints-board-360.png` (131 KB) | `docs/staff-complaints-ui.md` |
| `/staff/reconciliation and /staff/reconciliation/[importId]` | payments:match | import and reconcile bank rows | `docs/screenshots/reconciliation-workspace-needs-you-1280.png` (283 KB), `docs/screenshots/reconciliation-workspace-needs-you-360.png` (243 KB) | `docs/ui-audit-reconciliation.md` |
| `/staff/reports` | reports:view | committee overview | `docs/screenshots/committee-overview-1280.png` (96 KB), `docs/screenshots/committee-overview-1280x800.png` (75 KB) | `docs/committee-report.md` |
| `/staff/reports/collections` | reports:view | collections page | `docs/screenshots/committee-collections-1280.png` (178 KB), `docs/screenshots/committee-collections-1280x800.png` (58 KB) | `docs/committee-report.md` |
| `/staff/reports/dues` | reports:view | dues page with the drill-down | `docs/screenshots/committee-dues-1280.png` (176 KB), `docs/screenshots/committee-dues-360.png` (157 KB) | `docs/committee-report.md` |
| `/staff/reports/complaints` | reports:view | complaints page | `docs/screenshots/committee-complaints-1280.png` (139 KB), `docs/screenshots/committee-complaints-360.png` (88 KB) | `docs/committee-report.md` |
| `/staff/reports/bank` | reports:view | bank matching page | `docs/screenshots/committee-bank-1280.png` (36 KB), `docs/screenshots/committee-bank-360.png` (25 KB) | `docs/committee-report.md` |
| `/design` | developer (flag) | design token page | none | `docs/design-system.md` |
