FACTS ONLY. The human writes the narrative and the reasoning.

# 03 Flows

Five flows. Each step names the code, what it does and what it guarantees.
Every `file :: function` pair was checked by grep in this session.
Orientation came from `docs/walkthrough.md`. The code was read for each step.

## Flow 1. Login, sessions and the cookie

| # | Step | Where | What happens | What it guarantees |
|---|---|---|---|---|
| 1 | Form posts the phone | `src/app/login/login-form.tsx :: LoginForm` | Sends JSON to the request route. | Nothing yet. |
| 2 | Route is public | `src/server/auth/guard.ts :: publicRoute` | Runs the CSRF check, then the handler. | Cross-site POST gets 403 CSRF_BLOCKED. |
| 3 | Handler parses body | `src/server/auth/handlers.ts :: handleOtpRequest` | Zod body, max length, then calls the service. | Bad body is 400 INVALID_REQUEST. |
| 4 | Normalise phone, check limits | `src/server/auth/otp-service.ts :: requestOtp` | Reads last hour of codes by phone and by address hash. | Cooldown and hourly limits apply. |
| 5 | Limit decision | `src/domain/auth/otp.ts :: evaluateOtpRequest` | Pure function returns allowed or a wait time. | Blocked request is not stored. |
| 6 | Make the code | `src/domain/auth/otp.ts :: otpFromRandom` | Six digits from random words, no modulo bias. | Every code is equally likely. |
| 7 | Store hash only | `src/server/auth/crypto.ts :: codeHash` | Keyed hash of phone and code. Older unused codes are retired in the same transaction. | The code is never stored in clear. Only the newest code works. |
| 8 | Send | `src/server/auth/otp-service.ts :: mockOtpSender` | Mock sender sends nothing. Only active users get a send call. | Same answer for known and unknown phones. |
| 9 | Demo code | `src/server/auth/otp-service.ts :: requestOtp` | Returns demoCode only if DEMO_MODE is exactly true and phone is a demo phone. | No code in the answer otherwise. |
| 10 | Verify request | `src/server/auth/handlers.ts :: handleOtpVerify` | Parses phone and code, calls the service. | Refusals use generic message keys. |
| 11 | Check code | `src/server/auth/otp-service.ts :: verifyOtp` | Loads newest code row, compares hashes in constant time. | Old, wrong, expired and unknown read the same. |
| 12 | Attempt rule | `src/domain/auth/otp.ts :: evaluateOtpAttempt` | Pure: consumed, expired, locked, wrong or ok. | Expiry is exact. |
| 13 | Count a wrong guess | `src/server/auth/otp-service.ts :: addAttempt` | One UPDATE with attempts below the limit. | Parallel guesses cannot pass the limit. |
| 14 | Use the code once | `src/server/auth/otp-service.ts :: consume` | One UPDATE where consumed_at is null. | A code works once. |
| 15 | Create session | `src/server/auth/session-service.ts :: createSession` | Random token, stores SHA-256 of it, sets the end time by role. | Raw token is nowhere in the database. |
| 16 | Session end time | `src/domain/auth/session.ts :: newSessionExpiry` | Absolute limit by role. | Staff 12 hours, resident 30 days. |
| 17 | Set cookie | `src/server/auth/cookie.ts :: buildSessionCookie` | HttpOnly, SameSite=Lax cookie. Name is `__Host-session` over https. | Cookie is not readable by scripts. |
| 18 | Audit | `src/server/auth/handlers.ts :: handleOtpVerify` | Writes LOGIN_SUCCEEDED to audit_log with a hashed address. | Login is on record. |
| 19 | Every later request | `src/server/auth/session-service.ts :: resolveSession` | Loads session and user in one query. | Revoked, expired or inactive user gets null. |
| 20 | Idle and absolute rule | `src/domain/auth/session.ts :: evaluateSession` | Pure: valid or not, and whether to touch last_seen_at. | Staff 30 minutes idle, resident 14 days idle. |
| 21 | Guard on API routes | `src/server/auth/guard.ts :: createGuards` | CSRF, then session (401), then permission (403, audited). | Order is fixed. |
| 22 | Guard on pages | `src/server/auth/current-user.ts :: requireUser` | Redirects to login or to /forbidden. | Pages are not served without a user. |
| 23 | Logout | `src/server/auth/handlers.ts :: handleLogout` | Revokes the session, clears both cookie names, answers 204. | Repeatable. Says nothing about the session. |
| 24 | Logout everywhere | `src/server/auth/session-service.ts :: revokeAllSessions` | Revokes every session of the user. | All devices end. |

## Flow 2. Paying a bill

| # | Step | Where | What happens | What it guarantees |
|---|---|---|---|---|
| 1 | Resident sees the amount | `src/server/home/home-data.ts :: getHomeData` | Loads bills and entries, builds the Home. | Home uses the same position function as payment. |
| 2 | One position function | `src/domain/billing/dues.ts :: positionsForFlat` | Position of each bill: open, fee only or settled. | Home, lock, import and report agree. |
| 3 | Late fee | `src/domain/billing/late-fee.ts :: computeLateFee` | Daily balance, simple interest, one rounding on the total. | Fee is computed, never stored until posting. |
| 4 | Tap Pay | `src/app/(resident)/dues-sheet.tsx :: DuesActions` | POSTs the amount the person saw, as a decimal string. | The server can detect a stale amount. |
| 5 | Route | `src/app/api/payments/route.ts :: POST` | Wrapped by withPermission with RESIDENT. | Only a resident can start a payment. |
| 6 | Demo mode gate | `src/server/payments/handlers.ts :: handleInitiate` | 503 unless DEMO_MODE is exactly true. | Only the mock gateway exists. |
| 7 | Lock the amount | `src/domain/payments/amount-lock.ts :: lockAmount` | Oldest open bill: principal plus fee, or the fee alone. | Amount is fixed at tap time. |
| 8 | Compare to what was seen | `src/server/payments/initiate.ts :: initiatePayment` | Different amount gives AMOUNT_CHANGED and creates nothing. | No payment at a surprise amount. |
| 9 | Create the attempt | `src/server/payments/initiate.ts :: initiatePayment` | INITIATED attempt, reference `MOCK-<id>`, audit row, one transaction. | One unresolved attempt per bill (index). |
| 10 | Race loser | `src/server/payments/initiate.ts :: isUniqueViolation` | Loser of a race loads the winning attempt. | Parallel taps make one attempt. |
| 11 | Demo checkout page | `src/app/(demo)/pay/mock/[attemptId]/page.tsx :: MockCheckoutPage` | Shows the mock checkout. | Not found unless DEMO_MODE is true. |
| 12 | Button | `src/app/(demo)/pay/mock/[attemptId]/actions.ts :: paySuccessfully` | Calls the mock completion. | The action re-checks the person. |
| 13 | Build and sign event | `src/server/payments/mock-checkout.ts :: completeMockPayment` | Builds the event, signs it with the webhook secret. | Demo uses the real verify path. |
| 14 | Signature | `src/server/payments/webhook.ts :: signWebhook` | HMAC-SHA256 over timestamp, dot, raw body. | Tampering breaks the signature. |
| 15 | Real webhook route | `src/app/api/payments/webhook/route.ts :: POST` | publicRoute. The signature is the only authentication. | No session needed. |
| 16 | Handler | `src/server/payments/handlers.ts :: handleWebhook` | Size cap, verify, apply, answer 200 for every decision. | Answer reveals nothing about the books. |
| 17 | Verify | `src/server/payments/webhook.ts :: verifyWebhook` | Constant-time compare. Timestamp window is 300 seconds. | Replays after 5 minutes are refused. |
| 18 | Apply | `src/server/payments/webhook.ts :: applyGatewayEvent` | Locks the attempt row, then the bill. One transaction with deadlock retry. | Ten parallel successes post once. |
| 19 | Per-bill lock | `src/server/payments/bill-lock.ts :: lockBill` | Advisory lock on the bill id. The bank import takes the same lock. | Gateway and bank cannot both pay one bill. |
| 20 | Decide | `src/domain/payments/attempt-state.ts :: decideGatewayEvent` | Pure: POST, MARK_FAILED, DUPLICATE or EXCEPTION. | Posts only when every guard holds. |
| 21 | Plan entries | `src/domain/billing/posting.ts :: planPosting` | A LATE_FEE once, then one PAYMENT. | Fee is posted once. |
| 22 | Post | `src/server/payments/webhook.ts :: applyGatewayEvent` | Writes ledger rows, sets attempt SUCCEEDED, writes audit. | Entries are dated the attempt start day. |
| 23 | Contradiction | `src/server/payments/webhook.ts :: applyGatewayEvent` | EXCEPTION opens one queue item and posts nothing. | Contradicting signals never auto-post. |
| 24 | Back to Home | `src/app/(demo)/pay/mock/[attemptId]/actions.ts :: payFails` | Failure button sends a signed failed event. | Failed attempt frees the bill. |

## Flow 3. Bank statement import and reconciliation

| # | Step | Where | What happens | What it guarantees |
|---|---|---|---|---|
| 1 | Upload | `src/app/api/statements/route.ts :: POST` | withPermission with payments:match. | Only matching staff upload. |
| 2 | Body and size | `src/server/statements/handlers.ts :: handleImport` | Zod body with filename and csv. Size cap. | Bad body is 400. Big body is 413. |
| 3 | Early refusal | `src/server/statements/import.ts :: importStatement` | Size, row count and NUL byte checks run before any database work. | A refused file stores nothing. |
| 4 | Parse CSV | `src/domain/matching/csv.ts :: parseStatementCsv` | Hand-written reader gives rows with integer paise or row errors. | Missing header is a fatal error. |
| 5 | Row keys | `src/domain/matching/dedupe.ts :: computeRowKeys` | Stable key per row. | Same file twice is ALREADY_IMPORTED. |
| 6 | Narration | `src/domain/matching/narration.ts :: parseNarration` | Pulls rail, reference, UPI id, name and flat codes from the text. | Raw narration is kept separately. |
| 7 | Import lock | `src/server/statements/import.ts :: importStatement` | One transaction. Advisory lock `statement-import`, lock timeout 5 seconds. | Imports run one at a time. |
| 8 | Process | `src/domain/matching/processor.ts :: processStatement` | Orders rows, decides each one, plans entries. | Every row gets exactly one state. |
| 9 | Decide a row | `src/domain/matching/decide.ts :: matchRow` | Rules M0 to M7, first decision wins. M4 needs every auto condition. | Unclear matches are queued, never posted. |
| 10 | Books check | `src/domain/matching/processor.ts :: accountingReport` | Compares counts of rows and states. | Processor books must add up. |
| 11 | Stale check | `src/server/statements/import.ts :: staleRows` | Locks the bills of auto rows and re-checks them. | A changed bill downgrades the row to QUEUED. |
| 12 | Downgrade | `src/domain/matching/processor.ts :: downgradeRows` | Pure: moves stale rows to QUEUED with a reason. | No auto-post on stale facts. |
| 13 | Auto-post | `src/server/statements/import.ts :: importStatement` | Writes bank rows, ledger entries, match rows, queue items and audit. | One PAYMENT per bank row. |
| 14 | Reference | `src/server/statements/reference.ts :: bankReference` | Builds the unique ledger reference. | No narration text in the reference. |
| 15 | Read back | `src/server/statements/import.ts :: isAccounted` | Compares stored counts to the processor books. Mismatch rolls back. | Nothing is saved unless every row is accounted for. |
| 16 | Queue review | `src/server/statements/review.ts :: listRows` | Lists rows by lane. | Staff see what needs a person. |
| 17 | Manual match route | `src/app/api/bank-rows/[id]/match/route.ts :: POST` | withPermission with payments:match. | Match needs that permission. |
| 18 | Manual match | `src/server/statements/manual.ts :: postManualMatch` | Locks the row, checks version, reason of 5 to 500 characters. | A human decision has a reason. |
| 19 | Plan under lock | `src/server/statements/manual-core.ts :: planUnderLock` | Locks the oldest open bill and plans the entries. | Oldest bill is paid first. |
| 20 | Threshold | `src/server/statements/manual.ts :: postManualMatch` | Credit at or above the setting becomes AWAITING_APPROVAL with a REQUEST_APPROVAL decision. | Nobody posts a large credit alone. |
| 21 | Post below threshold | `src/server/statements/manual-core.ts :: postMatch` | Writes entries, sets MANUALLY_MATCHED, records decision, resolves queue item. | Idempotency key is `manual:<rowId>:<TYPE>`. |
| 22 | Approve route | `src/app/api/bank-rows/[id]/approve/route.ts :: POST` | withPermission with payments:approve. | Approval needs that permission. |
| 23 | Approve | `src/server/statements/approval.ts :: approveRequest` | Refuses the requester, re-plans under lock, then posts. | Approver differs from requester. |
| 24 | Changed since request | `src/server/statements/approval.ts :: approveRequest` | Bill changed: REJECTED decision, row back to QUEUED, STATE_CHANGED. | No stale approval posts. |
| 25 | Reject | `src/server/statements/approval.ts :: rejectRequest` | Row returns to QUEUED with a reason. | Queue item stays open. |
| 26 | Ignore | `src/server/statements/approval.ts :: ignoreRow` | Same threshold rule applies to ignoring a large credit. | Large ignores also need a second person. |

## Flow 4. A complaint

| # | Step | Where | What happens | What it guarantees |
|---|---|---|---|---|
| 1 | Form asks about danger | `src/app/(resident)/complaints/new/new-complaint-view.tsx :: DangerOption` | Resident answers whether anyone is in danger. | Declared danger is sent with the text. |
| 2 | Route and body | `src/server/complaints/handlers.ts :: handleCreate` | Strict zod body with body text and declaredDanger. | Unknown fields are refused. |
| 3 | Create | `src/server/complaints/create.ts :: createComplaint` | Resident only. Trims text, finds the flat, checks for a repeat. | Same text within 60 seconds is one complaint. |
| 4 | Classify outside the transaction | `src/server/complaints/classify.ts :: classifyComplaint` | Runs before any transaction opens. | A slow classifier holds no connection. |
| 5 | Safety words first | `src/domain/complaints/safety.ts :: detectSafetyWords` | Reads the original text. A hit skips every model. | Safety rules run before any model. |
| 6 | Declared danger | `src/server/complaints/classify.ts :: declaredDecision` | Same path as a safety word, with any text. | CRITICAL without a model call. |
| 7 | De-identify | `src/domain/complaints/deidentify.ts :: deidentify` | Replaces phones, e-mails, links, flat codes and known names. | Only reduced text leaves the server. |
| 8 | Budget | `src/server/complaints/classifier.ts :: classifyWithin` | Hard total of 4000 ms. Throw, timeout or none is no answer. | A complaint is never refused for a provider fault. |
| 9 | Provider chain | `src/server/complaints/providers/classifier-jev.ts :: JevClassifier` | Tries the first provider, then the second. One attempt each. | Skips a provider over its cap or with an open breaker. |
| 10 | Build the chain | `src/server/complaints/providers/factory.ts :: createClassifierFromEnv` | Reads the configuration. Bad settings are skipped. | No provider gives the null classifier. |
| 11 | Provider reply | `src/server/complaints/providers/system-one.ts :: parseResponse` | Parses the distributions. | Unknown labels are rejected. |
| 12 | Decide | `src/domain/complaints/decision.ts :: decideClassification` | Validates arms, applies thresholds, else keyword fallback, else triage. | A model result is never CRITICAL. |
| 13 | Keyword fallback | `src/domain/complaints/fallback.ts :: classifyByKeywords` | Answers when no valid model answer exists. | Always some outcome. |
| 14 | Write the complaint | `src/server/complaints/create.ts :: createComplaint` | One transaction under an advisory lock. Complaint, classification, events, notification. | All written together or not at all. |
| 15 | Duty manager | `src/server/complaints/create.ts :: createComplaint` | Safety complaint is assigned to the duty manager and a notification is written. | No duty manager leaves it NEW with a note. |
| 16 | Reply clock | `src/domain/complaints/lifecycle.ts :: responseDueAt` | Due time by urgency. | CRITICAL 15 minutes. |
| 17 | Staff board | `src/server/complaints/staff-page-data.ts :: loadBoardPage` | Loads one view and counts for every view. | Lists stay paged. |
| 18 | Board query | `src/server/complaints/board-views.ts :: listBoardView` | Filters by view, category, assignee and urgency. | Needs complaints:manage. |
| 19 | Lazy auto-close | `src/server/complaints/auto-close.ts :: autoCloseQuietly` | Runs when pages load. No scheduler. | A failure does not break the page. |
| 20 | Assign | `src/server/complaints/staff-actions.ts :: assign` | Row lock and expected version. | Two staff at once: one wins, one gets STALE. |
| 21 | Status | `src/server/complaints/staff-actions.ts :: setStatus` | Moves to IN_PROGRESS or PENDING_CONFIRMATION. | Only moves the state machine allows. |
| 22 | State machine | `src/domain/complaints/lifecycle.ts :: applyTransition` | Pure function of state and action. | Output always satisfies the database checks. |
| 23 | Acknowledge | `src/server/complaints/safety.ts :: acknowledgeSafety` | Sets first_response_at once and adds an event the resident never sees. | Needs the duty manager permission. |
| 24 | Close a safety complaint | `src/server/complaints/safety.ts :: closeSafety` | Closes with a note of 5 to 500 characters. | Only the duty manager closes it. |
| 25 | Resident confirms | `src/server/complaints/resident.ts :: confirmFixed` | PENDING_CONFIRMATION to CLOSED with optional rating. | Not allowed on a safety complaint. |
| 26 | Resident reopens | `src/server/complaints/resident.ts :: reopen` | Reason of 5 to 500 characters. Closed complaints reopen within 7 days. | Reopen count goes up. |
| 27 | Auto-close | `src/server/complaints/auto-close.ts :: autoCloseDue` | Non-safety complaints waiting 7 days are closed. | A safety complaint is never auto-closed. |

## Flow 5. The committee report

| # | Step | Where | What happens | What it guarantees |
|---|---|---|---|---|
| 1 | Overview page | `src/app/(staff)/staff/reports/page.tsx :: ReportsPage` | Reads month from the query string. Calls requireUser with reports:view. | Others are sent away. |
| 2 | Old drill-down address | `src/app/(staff)/staff/reports/page.tsx :: ReportsPage` | A `bucket` query on the overview redirects to the dues page. | Old links still work. |
| 3 | Load | `src/server/reports/report-data.ts :: loadCommitteeReport` | Checks the permission again at the data. Business date decides "as of". | Permission is checked twice. |
| 4 | Permission at data | `src/server/statements/ui-data.ts :: requirePermission` | Throws without reports:view. | Resident and other staff are refused. |
| 5 | Positions | `src/server/reports/positions.ts :: loadReportPositions` | Three queries, then positions built in memory per flat. | Uses the same positionsForFlat as the Home. |
| 6 | Period choice | `src/lib/reports/period.ts :: choosePeriod` | Picks the requested month or a default. | Month options come from billed periods. |
| 7 | Money line | `src/domain/reports/money-line.ts :: moneyLine` | Billed, collected, outstanding for the month. | Billed equals collected plus outstanding. |
| 8 | Quality | `src/domain/reports/money-line.ts :: collectionQuality` | On-time share and paid-in-full counts. | Judged on counts. |
| 9 | Ageing | `src/domain/reports/age.ts :: ageingTable` | Five age groups. | Same positions as the money line. |
| 10 | Towers | `src/domain/reports/towers.ts :: towerRollup` | Per-tower roll-up. | Flat codes only, no names. |
| 11 | Complaints | `src/server/reports/complaints.ts :: loadComplaintsBetween` | One window of complaints. | Window is read once. |
| 12 | Complaint metrics | `src/domain/reports/complaints.ts :: complaintMetrics` | First reply within the time limit, reopened share. | Zero denominator shows no data. |
| 13 | Goals | `src/domain/reports/goals.ts :: evaluateGoals` | Compares counts to targets. | Rounding cannot pass a target. |
| 14 | Bank line | `src/server/reports/reconciliation.ts :: loadReconciliationLine` | Last 30 days of imports and decisions. Three queries. | Read only. |
| 15 | Series | `src/domain/reports/series.ts :: monthlySeries` | Monthly series cut in memory. | No extra queries. |
| 16 | Cards | `src/lib/reports/cards.ts :: buildCards` | Four headline cards for the overview. | Cards use the same figures. |
| 17 | Overview view | `src/app/(staff)/staff/reports/report-view.tsx :: ReportView` | Alert strip, month form, headline cards, "Look closer", about block. | Read only. |
| 18 | Section slugs | `src/lib/reports/sections.ts :: sectionFromSlug` | Accepts exactly four slugs. | Anything else is a 404. |
| 19 | Section page | `src/app/(staff)/staff/reports/[section]/page.tsx :: ReportSectionPage` | Same permission and loader as the overview. | Same rules as the overview. |
| 20 | Collections | `src/app/(staff)/staff/reports/section-page.tsx :: SectionPage` | Money block, payment-speed block and monthly block. Route is `/staff/reports/collections`. | Month selector applies. |
| 21 | Dues | `src/app/(staff)/staff/reports/section-page.tsx :: SectionPage` | Ageing block, drill-down, late-fee figures and towers. Route is `/staff/reports/dues`. | Shows all months. |
| 22 | Drill-down | `src/server/reports/ageing-page.ts :: loadAgeingPage` | Pages the flats of one age group. | Cursor paging. |
| 23 | Complaints page | `src/app/(staff)/staff/reports/section-page.tsx :: SectionPage` | Complaint block. Route is `/staff/reports/complaints`. | Month selector applies. |
| 24 | Bank page | `src/app/(staff)/staff/reports/section-page.tsx :: SectionPage` | Reconciliation block. Route is `/staff/reports/bank`. | Last 30 days only. |

## Notes on layout

- The code has an overview and four section pages. `docs/committee-report.md` still describes five collapsible sections on one page. This file follows the code.
