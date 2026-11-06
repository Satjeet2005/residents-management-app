// Smoke test for the resident app pages over real HTTP. No dependencies: Node 24's fetch.
//
//   node scripts/smoke-app.mjs <BASE_URL> --as-of=2026-10-27 --demo=true     the server runs with DEMO_AS_OF=2026-10-27
//   node scripts/smoke-app.mjs <BASE_URL> --as-of=real --demo=true           the server uses the real India date
//   npm run smoke:app -- http://localhost:3100 --as-of=real --demo=false
//
// It logs in as the T12-0408 resident (5000000007, Swati Joshi) and as a staff member (5000000001, Priya Nair) of the
// demo data, and checks the pages. The expected numbers are worked out here, independently of the app, with BigInt.
// It never prints a code, a token, a cookie or the webhook secret, only lengths.
//
// The pay flow (with --demo=true, which logging in needs anyway) needs the server's PAYMENT_WEBHOOK_SECRET in THIS script's
// environment too, as the variable PAYMENT_WEBHOOK_SECRET: it signs the events a real gateway would send. That a live
// deployment answers 503 and has no demo checkout is tested in tests/integration/payments-initiate.test.ts and payments-mock.test.ts
// (a session cannot be made over HTTP without demo mode).

import { createHmac } from "node:crypto";

const args = process.argv.slice(2);
const baseUrl = (args.find((a) => /^https?:\/\//.test(a)) ?? process.env.BASE_URL ?? "").replace(/\/+$/, "");
const asOfArg = (args.find((a) => a.startsWith("--as-of=")) ?? "--as-of=real").slice("--as-of=".length);
const expectDemoNote = (args.find((a) => a.startsWith("--demo=")) ?? "--demo=false").slice("--demo=".length) === "true";
if (!baseUrl || !(asOfArg === "real" || /^\d{4}-\d{2}-\d{2}$/.test(asOfArg))) {
  console.error("Usage: node scripts/smoke-app.mjs <BASE_URL> --as-of=<YYYY-MM-DD|real> --demo=<true|false>");
  process.exit(2);
}

const RESIDENT = "5000000007";
const RESIDENT_PART_PAID = "5000000009";
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? "";
const STAFF = "5000000001";
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

// --- The expected numbers, worked out on their own ---
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const asOf = asOfArg === "real" ? new Date(Date.now() + 19_800_000).toISOString().slice(0, 10) : asOfArg;
const dayNumber = (d) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000);
const overdueDays = dayNumber(asOf) - dayNumber("2026-09-10");
const BILL = 637_000n;
const numerator = BILL * 1200n * BigInt(overdueDays);
const fee = ((2n * numerator + 3_650_000n * 100n) / (2n * 3_650_000n * 100n)) * 100n;
const duePaise = BILL + fee;
const rupees = (paise) => {
  const digits = (paise / 100n).toString();
  const grouped = digits.length <= 3 ? digits : `${digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${digits.slice(-3)}`;
  return `₹${grouped}${paise % 100n === 0n ? "" : `.${(paise % 100n).toString().padStart(2, "0")}`}`;
};
const asOfText = `${+asOf.slice(8)} ${MONTHS[+asOf.slice(5, 7) - 1]}`;
const frozenToTheBrief = asOf === "2026-10-27";

// --- HTTP ---
async function get(path, cookie) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
  const html = await response.text();
  return { status: response.status, location: response.headers.get("location"), html, text: html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ") };
}
async function post(path, body, cookie) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json, setCookie: response.headers.getSetCookie?.()[0] ?? "" };
}
async function login(phone) {
  const asked = await post("/api/auth/otp/request", { phone });
  const code = asked.json?.demoCode;
  if (!/^[0-9]{6}$/.test(code ?? "")) return null;
  const verified = await post("/api/auth/otp/verify", { phone, code });
  const pair = verified.setCookie.split(";")[0];
  return verified.status === 200 && pair.includes("=") ? pair : null;
}

/** The headers of a signed webhook event: the time in seconds and HMAC-SHA256 of `${timestamp}.${body}`. The secret is never printed. */
function signedHeaders(rawBody, at = Date.now()) {
  const timestamp = String(Math.floor(at / 1000));
  return { "x-timestamp": timestamp, "x-signature": createHmac("sha256", WEBHOOK_SECRET).update(`${timestamp}.${rawBody}`).digest("hex") };
}
async function webhook(rawBody, headers) {
  const response = await fetch(`${baseUrl}/api/payments/webhook`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: rawBody, redirect: "manual" });
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json };
}
const eventBody = (type, attempt) => JSON.stringify({ eventId: `smoke-${Math.random().toString(36).slice(2)}`, type, reference: `MOCK-${attempt.attemptId}`, amountPaise: attempt.amountPaise });
/** The amount on the Pay button, in paise: "Pay ₹6,468" or "Pay oldest bill ₹6,468" (whole rupees). */
function payButtonPaise(html) {
  const match = /<button[^>]*>Pay (?:oldest bill )?₹([0-9,]+)<\/button>/.exec(html);
  return match ? BigInt(match[1].replaceAll(",", "")) * 100n : null;
}

/** Where the first "didn't go through" is in the HTML (the apostrophe is plain or escaped, depending on how the page was streamed). */
const stripAt = (html) => html.search(/didn(?:'|&#x27;)t go through/);

/** A page that sends a person elsewhere: a real redirect (3xx with a Location), or the 200 page with the meta refresh that Next.js writes once a loading state has started streaming. */
function redirectTarget(page) {
  if (page.status >= 300 && page.status < 400 && page.location) return { how: `${page.status} Location`, to: page.location };
  const meta = /<meta[^>]*http-equiv="refresh"[^>]*content="[0-9]+;url=([^"]+)"/.exec(page.html);
  return meta ? { how: `${page.status} meta refresh`, to: meta[1] } : null;
}

async function run() {
  console.log(`business date used for the expectations: ${asOf} (${asOfArg === "real" ? "real India date" : "frozen"}), ${overdueDays} days overdue, due ${rupees(duePaise)}`);

  // 1. Not signed in.
  const loginPage = await get("/login");
  check("GET /login: 200, one h1 'Log in', a phone field with a numeric keypad", loginPage.status === 200 && (loginPage.html.match(/<h1/g) ?? []).length === 1 && loginPage.text.includes("Log in") && loginPage.html.includes('inputMode="numeric"') && loginPage.html.includes('autoComplete="tel"'), `status ${loginPage.status}`);
  check(
    expectDemoNote ? "GET /login: the demo explanation is shown (demo mode)" : "GET /login: no demo explanation (not demo mode)",
    loginPage.text.includes("About this demo data") === expectDemoNote && loginPage.text.includes("DEMO_AS_OF=2026-10-27") === expectDemoNote,
    "",
  );
  const anonymous = await get("/");
  const anonymousRedirect = redirectTarget(anonymous);
  check("GET / without a cookie goes to /login with a returnTo", anonymousRedirect !== null && anonymousRedirect.to === "/login?returnTo=%2F", anonymousRedirect ? `${anonymousRedirect.how} -> ${anonymousRedirect.to}` : `status ${anonymous.status}, no redirect`);
  check("GET / without a cookie shows no flat data in the body", !anonymous.text.includes("₹") && !anonymous.text.includes("T12-0408"), "");
  const anonymousProfile = redirectTarget(await get("/profile"));
  check("GET /profile without a cookie goes to /login with a returnTo", anonymousProfile?.to === "/login?returnTo=%2Fprofile", anonymousProfile ? `${anonymousProfile.how} -> ${anonymousProfile.to}` : "no redirect");
  const anonymousStaff = await get("/staff");
  const staffRedirect = redirectTarget(anonymousStaff);
  check("GET /staff without a cookie goes to /login with a returnTo", staffRedirect?.to === "/login?returnTo=%2Fstaff" && !anonymousStaff.text.includes("Priya"), staffRedirect ? `${staffRedirect.how} -> ${staffRedirect.to}` : "no redirect");

  // 2. The T12-0408 resident.
  const cookie = await login(RESIDENT);
  check("login as the T12-0408 resident (code is the demo code; lengths only)", cookie !== null, cookie ? `cookie length ${cookie.length}` : "could not log in: is the server in demo mode?");
  if (cookie === null) return;
  const home = await get("/", cookie);
  check("GET / as the resident: 200 with one h1 (the flat code) and the dues", home.status === 200 && (home.html.match(/<h1/g) ?? []).length === 1 && /<h1[^>]*>T12-0408<\/h1>/.test(home.html), `status ${home.status}`);
  check(`GET / shows ${rupees(duePaise)} due`, home.text.includes(rupees(duePaise)), "");
  check(`GET / shows '${overdueDays} days overdue'`, home.text.includes(`${overdueDays} days overdue`), "");
  check(`GET / labels the date: 'Amount due, as of ${asOfText}'`, home.text.includes(`Amount due, as of ${asOfText}`), "");
  check("GET / shows the water-leak complaint at step 2 of 4", home.text.includes("Water leak under the kitchen sink") && home.text.includes("Step 2 of 4"), "");
  check(
    frozenToTheBrief ? "GET / shows two visitors today and the reply due today at 5 pm (the brief's date)" : "GET / shows no visitors today and the reply overdue (a later date)",
    frozenToTheBrief ? home.text.includes("2 visitors expected today") && home.text.includes("Reply due today, 5 pm") : home.text.includes("No visitors expected today") && home.text.includes("Reply overdue"),
    "",
  );
  check(`GET / has a Pay button with the oldest bill's amount, ${rupees(duePaise)}, and the bank transfer panel`, payButtonPaise(home.html) === duePaise && home.text.includes("Paying by bank transfer instead?") && home.text.includes("Copy payment note"), `button ${payButtonPaise(home.html) ?? "missing"}`);
  const profile = await get("/profile", cookie);
  check("GET /profile: 200, name, phone masked to the last 4 digits, the flat with the relation", profile.status === 200 && profile.text.includes("Swati Joshi") && profile.text.includes("******0007") && profile.text.includes("T12-0408") && !profile.text.includes(RESIDENT), `status ${profile.status}`);
  check(
    expectDemoNote ? "GET /profile: the section 'About this demo data' is shown (demo mode)" : "GET /profile: no demo section (not demo mode)",
    profile.text.includes("About this demo data") === expectDemoNote,
    "",
  );
  const forbidden = await get("/staff", cookie);
  const forbiddenRedirect = redirectTarget(forbidden);
  const forbiddenPage = forbiddenRedirect ? await get(forbiddenRedirect.to) : null;
  check("a resident requesting /staff ends at /forbidden", forbiddenRedirect?.to === "/forbidden" && forbiddenPage?.status === 200 && forbiddenPage.text.includes("You cannot open this page"), forbiddenRedirect ? `${forbiddenRedirect.how} -> ${forbiddenRedirect.to}` : `status ${forbidden.status}, no redirect`);
  if (expectDemoNote) await residentPays(cookie, home);
  const logout = await post("/api/auth/logout", undefined, cookie);
  check("logout answers 204", logout.status === 204, `status ${logout.status}`);
  const after = await get("/", cookie);
  const afterRedirect = redirectTarget(after);
  check("after logout GET / goes to /login with a returnTo, with no flat data", afterRedirect?.to === "/login?returnTo=%2F" && !after.text.includes("₹"), afterRedirect ? `${afterRedirect.how} -> ${afterRedirect.to}` : "no redirect");

  // 3. Staff.
  const staffCookie = await login(STAFF);
  check("login as staff", staffCookie !== null, staffCookie ? `cookie length ${staffCookie.length}` : "could not log in");
  if (staffCookie === null) return;
  const staff = await get("/staff", staffCookie);
  check("GET /staff as staff: 200, one h1, the name, the permission in words, and the Bank reconciliation tool", staff.status === 200 && (staff.html.match(/<h1/g) ?? []).length === 1 && staff.text.includes("Signed in as Priya Nair") && staff.text.includes("Match bank payments") && /<a [^>]*href="\/staff\/reconciliation"[^>]*>Bank reconciliation<\/a>/.test(staff.html), `status ${staff.status}`);
  const staffHome = redirectTarget(await get("/", staffCookie));
  check("GET / as staff goes to /staff", staffHome?.to === "/staff", staffHome ? `${staffHome.how} -> ${staffHome.to}` : "no redirect");
  if (expectDemoNote && paidCheckoutPath !== null) {
    const staffCheckout = redirectTarget(await get(paidCheckoutPath, staffCookie));
    check("a staff member opening the demo checkout is sent to /forbidden (a real 307)", staffCheckout?.to === "/forbidden" && staffCheckout.how.startsWith("307"), staffCheckout ? `${staffCheckout.how} -> ${staffCheckout.to}` : "no redirect");
    const staffPay = await post("/api/payments", { expectedAmountPaise: "100" }, staffCookie);
    check("a staff member calling POST /api/payments gets 403", staffPay.status === 403, `status ${staffPay.status}`);
  }
  if (expectDemoNote) await staffImportsSample(staffCookie);
  if (expectDemoNote && paidCheckoutPath !== null) await partPaidResidentFails(paidCheckoutPath, staffCookie);
  await post("/api/auth/logout-all", undefined, staffCookie);
}

let paidCheckoutPath = null;
let sampleImportId = null;

/**
 * Staff upload the sample statement (src/server/statements/sample-statement.ts, read with Node's type stripping). The T12-0408 resident paid
 * through the gateway earlier in this script, so that flat's bank row is queued, not posted: the gateway and the bank never both pay one bill.
 * Every other number is the sample's own (docs/statement-import-design.md).
 */
async function staffImportsSample(staffCookie) {
  const { getSampleStatement } = await import("../src/server/statements/sample-statement.ts");
  const csv = getSampleStatement();
  const first = await post("/api/statements", { filename: "sample-statement.csv", csv }, staffCookie);
  const s = first.json?.summary ?? {};
  check(
    "POST /api/statements with the sample: 200, 106 rows, 24 posted, 44 queued, 38 ignored, none repeated, accounted true",
    first.status === 200 && s.rowsRead === 106 && s.validRows === 106 && s.invalidRows === 0 && s.autoMatched === 24 && s.queued === 44 && s.ignored === 38 && s.alreadyImported === 0 && s.downgraded === 0 && first.json?.accounted === true,
    `status ${first.status}, ${JSON.stringify({ a: s.autoMatched, q: s.queued, i: s.ignored })}`,
  );
  check("the sample's posted total is ₹1,43,899 (₹1,50,367 less T12-0408, which the gateway had already paid) and the credits ₹9,09,326", s.autoMatchedTotalPaise === "14389900" && s.creditTotalPaise === "90932600", `${s.autoMatchedTotalPaise} of ${s.creditTotalPaise}`);
  if (first.status !== 200) return;
  sampleImportId = first.json.importId;
  const stored = await fetch(`${baseUrl}/api/statements/${first.json.importId}`, { headers: { cookie: staffCookie } });
  const storedJson = await stored.json();
  check("GET /api/statements/<id> reads the same counts back from the database", stored.status === 200 && storedJson.accounted === true && storedJson.summary?.autoMatched === 24 && storedJson.summary?.queued === 44 && storedJson.summary?.ignored === 38, `status ${stored.status}`);
  const again = await post("/api/statements", { filename: "sample-statement.csv", csv }, staffCookie);
  check("POSTing the sample again: every one of the 106 rows is ALREADY_IMPORTED, nothing new is posted or queued", again.status === 200 && again.json?.summary?.alreadyImported === 106 && again.json?.summary?.autoMatched === 0 && again.json?.summary?.queued === 0 && again.json?.accounted === true, `status ${again.status}`);
  const bad = await post("/api/statements", { filename: "bad.csv", csv: "Date,Credit\n2026-10-26,5.00\n" }, staffCookie);
  check("a statement with no narration column is 422 INVALID_CSV", bad.status === 422 && bad.json?.error === "INVALID_CSV", `status ${bad.status}`);
}

/** The T12-0408 resident pays: lock the amount, a bad signature changes nothing, a signed success shows No dues. */
async function residentPays(cookie, homeBefore) {
  if (WEBHOOK_SECRET.length < 32) {
    check("PAYMENT_WEBHOOK_SECRET (at least 32 characters) is set in the smoke script's environment, the same value as the server's", false, `length ${WEBHOOK_SECRET.length}`);
    return;
  }
  const shown = payButtonPaise(homeBefore.html);
  const stale = await post("/api/payments", { expectedAmountPaise: String(shown + 100n) }, cookie);
  check("POST /api/payments with a stale amount is 409 AMOUNT_CHANGED with today's amount", stale.status === 409 && stale.json?.error === "AMOUNT_CHANGED" && stale.json?.amountPaise === String(shown), `status ${stale.status}`);
  const started = await post("/api/payments", { expectedAmountPaise: String(shown) }, cookie);
  const attempt = started.json;
  check("POST /api/payments with the displayed amount is 200 with an attempt, the checkout path and the same amount", started.status === 200 && /^[0-9a-f-]{36}$/.test(attempt?.attemptId ?? "") && attempt?.checkoutPath === `/pay/mock/${attempt?.attemptId}` && attempt?.amountPaise === String(shown), `status ${started.status}`);
  if (started.status !== 200) return;
  paidCheckoutPath = attempt.checkoutPath;
  const again = await post("/api/payments", { expectedAmountPaise: String(shown) }, cookie);
  check("a second tap returns the same attempt (idempotent)", again.status === 200 && again.json?.attemptId === attempt.attemptId, `status ${again.status}`);

  const checkout = await get(attempt.checkoutPath, cookie);
  check(
    "the demo checkout page shows the demo label, the two buttons, and no secret",
    checkout.status === 200 && checkout.text.includes("Demo payment page (mock gateway)") && checkout.text.includes("Pay successfully") && checkout.text.includes("Payment fails, no money taken") && !checkout.html.includes(WEBHOOK_SECRET),
    `status ${checkout.status}`,
  );

  const raw = eventBody("payment.succeeded", attempt);
  const noSignature = await webhook(raw, {});
  const badSignature = await webhook(raw, { ...signedHeaders(raw), "x-signature": "0".repeat(64) });
  const stampOld = await webhook(raw, signedHeaders(raw, Date.now() - 10 * 60_000));
  const tampered = await webhook(raw.replace(String(attempt.amountPaise), "100"), signedHeaders(raw));
  check(
    "a missing, wrong, 10-minute-old or tampered signature gets 401 BAD_SIGNATURE and no more",
    [noSignature, badSignature, stampOld, tampered].every((r) => r.status === 401 && JSON.stringify(r.json) === '{"error":"BAD_SIGNATURE"}'),
    [noSignature, badSignature, stampOld, tampered].map((r) => r.status).join(" "),
  );
  const stillDue = await get("/", cookie);
  const paymentLine = `Payment received ${rupees(shown)}`;
  check("after the refused events the Home still shows the dues and Pay, with no new ledger line", payButtonPaise(stillDue.html) === shown && !stillDue.text.includes(paymentLine) && stillDue.text.includes("Bill issued"), "");

  const good = await webhook(raw, signedHeaders(raw));
  check("a correctly signed success is 200", good.status === 200 && good.json?.ok === true, `status ${good.status}`);
  const paid = await get("/", cookie);
  check(
    `GET / then shows No dues, 'Payment received ${rupees(shown)}', the late fee line ${rupees(shown - BILL)}, and no Pay button`,
    paid.text.includes("No dues") && paid.text.includes(paymentLine) && paid.text.includes(`Late fee ${rupees(shown - BILL)}`) && payButtonPaise(paid.html) === null,
    "",
  );
  const replay = await webhook(raw, signedHeaders(raw));
  const afterReplay = await get("/", cookie);
  check("the same event replayed is 200 and changes nothing", replay.status === 200 && afterReplay.text === paid.text, `status ${replay.status}`);
}

/** The T21-1601 resident starts a payment and the gateway reports a failure: the strip shows and Pay is still there. */
async function partPaidResidentFails(otherCheckoutPath, staffCookie) {
  const cookie = await login(RESIDENT_PART_PAID);
  check("login as the T21-1601 resident", cookie !== null, cookie ? `cookie length ${cookie.length}` : "could not log in");
  if (cookie === null) return;
  const residentImport = await post("/api/statements", { filename: "s.csv", csv: "Txn Date,Narration,Credit,Debit\n2026-10-26,CASH,1.00,\n" }, cookie);
  check("a resident posting a statement gets 403", residentImport.status === 403, `status ${residentImport.status}`);
  const other = await get(otherCheckoutPath, cookie);
  check("a resident opening another flat's demo checkout gets a real HTTP 404", other.status === 404 && !other.text.includes("Pay successfully"), `status ${other.status}`);
  const home = await get("/", cookie);
  const shown = payButtonPaise(home.html);
  check("GET / shows a Pay button for the part-paid flat", shown !== null && home.text.includes("paid on 12 Oct") && !home.text.includes("didn't go through"), `button ${shown ?? "missing"}`);
  if (shown === null) return;
  const started = await post("/api/payments", { expectedAmountPaise: String(shown) }, cookie);
  check("POST /api/payments is 200 for the displayed amount", started.status === 200, `status ${started.status}`);
  if (started.status !== 200) return;
  const raw = eventBody("payment.failed", started.json);
  const failed = await webhook(raw, signedHeaders(raw));
  check("a correctly signed failure is 200", failed.status === 200, `status ${failed.status}`);
  const after = await get("/", cookie);
  check(
    "GET / shows 'That payment didn't go through. No money left your account.' above the dues, and Pay is still shown with the same amount",
    after.text.includes("That payment didn't go through. No money left your account.") && payButtonPaise(after.html) === shown && stripAt(after.html) >= 0 && stripAt(after.html) < after.html.indexOf("Amount due, as of"),
    `strip at ${stripAt(after.html)}, amount label at ${after.html.indexOf("Amount due, as of")}, button ${payButtonPaise(after.html) ?? "missing"}`,
  );
  await reconcile(staffCookie, cookie);
  await post("/api/auth/logout-all", undefined, cookie);
}

async function api(method, path, cookie, body) {
  const headers = cookie ? { cookie } : {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

/** The first row of a lane page, or the row whose narration holds `text`, looking through every page of the NEEDS_YOU lane. */
async function findQueuedRow(cookie, text) {
  let cursor = "";
  for (let page = 0; page < 10; page++) {
    const result = await api("GET", `/api/statements/${sampleImportId}/rows?lane=NEEDS_YOU&limit=50${cursor}`, cookie);
    const hit = result.json?.items?.find((row) => row.narrationRaw.includes(text));
    if (hit) return hit;
    if (!result.json?.nextCursor) return null;
    cursor = `&cursor=${result.json.nextCursor}`;
  }
  return null;
}

/**
 * Reconciliation over HTTP (T12b): staff list the imports and the NEEDS_YOU lane, review the first row, match the principal-only payment of T21-1601
 * by hand (the counts move by one and the resident's Home then says "Late fee due"), ask for approval of a credit above the threshold and approve it
 * as a second staff user, and a resident is refused everywhere. Every number is the sample's own. No code, cookie or secret is printed.
 */
async function reconcile(staffCookie, residentCookie) {
  const second = await login("5000000002");
  check("login as the second staff user (Rahul Menon, who may approve)", second !== null, second ? `cookie length ${second.length}` : "could not log in");
  if (second === null || sampleImportId === null) return;

  const imports = await api("GET", "/api/statements", staffCookie);
  check("GET /api/statements lists the imports, the sample's first import among them, newest first, at most 10", imports.status === 200 && imports.json?.imports?.some((i) => i.importId === sampleImportId) && imports.json.imports.length <= 10 && imports.json.imports.every((i, k, all) => k === 0 || all[k - 1].uploadedAt >= i.uploadedAt), `status ${imports.status}`);
  const before = await api("GET", `/api/statements/${sampleImportId}/rows?lane=NEEDS_YOU&limit=50`, staffCookie);
  const lanes = before.json?.laneCounts ?? {};
  check("the NEEDS_YOU lane holds 44 rows, 24 are matched and 38 are not maintenance; a page has at most 50, biggest amount first", before.status === 200 && lanes.NEEDS_YOU === 44 && lanes.MATCHED === 24 && lanes.NOT_MAINTENANCE === 38 && lanes.AWAITING_APPROVAL === 0 && before.json.items.length === 44 && before.json.items.every((row, i, all) => i === 0 || BigInt(all[i - 1].amountPaise) >= BigInt(row.amountPaise)), JSON.stringify(lanes));
  const first = before.json?.items?.[0];
  const reviewed = await api("GET", `/api/bank-rows/${first?.id}`, staffCookie);
  check("GET /api/bank-rows/<id> reviews the first row: its version, plain-English reasons and at most 5 candidate flats", reviewed.status === 200 && reviewed.json?.version === 1 && reviewed.json?.decision?.reasons?.length > 0 && reviewed.json.decision.reasons.every((r) => r.text.length > 10) && reviewed.json.candidates.length <= 5, `status ${reviewed.status}`);

  const principal = await findQueuedRow(staffCookie, "710000000003");
  const principalReview = principal ? await api("GET", `/api/bank-rows/${principal.id}`, staffCookie) : null;
  const t21 = principalReview?.json?.candidates?.find((c) => c.flatCode === "T21-1601");
  check("the ₹5,660 row of T21-1601 is reviewed: the flat's open position is ₹5,660 principal plus ₹38, ₹5,698 due", principal !== null && t21?.openPositions?.[0]?.principalOutstandingPaise === "566000" && t21.openPositions[0].feePaise === "3800" && t21.openPositions[0].amountDuePaise === "569800" && t21.amountRelation === "EQUALS_PRINCIPAL", principal ? `relation ${t21?.amountRelation}` : "row not found");
  if (!principal || !t21) return;

  const noReason = await api("POST", `/api/bank-rows/${principal.id}/match`, staffCookie, { flatCode: "T21-1601", reason: "ok", rememberPayer: false, expectedVersion: 1 });
  check("a match with a one-word reason is 422 REASON_REQUIRED and changes nothing", noReason.status === 422 && noReason.json?.error === "REASON_REQUIRED", `status ${noReason.status}`);
  const posted = await api("POST", `/api/bank-rows/${principal.id}/match`, staffCookie, { flatCode: "T21-1601", reason: "Owner paid the bill at the branch, confirmed by phone", rememberPayer: false, expectedVersion: 1, expectedAmountDuePaise: "569800" });
  check(
    "POST /api/bank-rows/<id>/match below the threshold: 200 POSTED, a LATE_FEE of ₹38 and ONE PAYMENT of ₹5,660, ₹38 of late fee still owing",
    posted.status === 200 && posted.json?.status === "POSTED" && JSON.stringify(posted.json.entries) === '[{"entryType":"LATE_FEE","amountPaise":"3800"},{"entryType":"PAYMENT","amountPaise":"566000"}]' && posted.json.remaining?.kind === "FEE_ONLY" && posted.json.remaining.feeOwedPaise === "3800",
    `status ${posted.status}`,
  );
  const repeated = await api("POST", `/api/bank-rows/${principal.id}/match`, staffCookie, { flatCode: "T21-1601", reason: "Owner paid the bill at the branch, confirmed by phone", rememberPayer: false, expectedVersion: 1 });
  check("the same match again is 409 (the row is no longer queued)", repeated.status === 409 && ["NOT_QUEUED", "STALE"].includes(repeated.json?.error), `status ${repeated.status}`);
  const afterMatch = await api("GET", `/api/statements/${sampleImportId}/rows?lane=NEEDS_YOU&limit=1`, staffCookie);
  check("the counts moved by one: NEEDS_YOU 43, MATCHED 25", afterMatch.json?.laneCounts?.NEEDS_YOU === 43 && afterMatch.json.laneCounts.MATCHED === 25, JSON.stringify(afterMatch.json?.laneCounts));
  const residentHome = await get("/", residentCookie);
  check("GET / as the T21-1601 resident now says 'Late fee due' with ₹38 and a Pay ₹38 button", residentHome.text.includes("Late fee due") && payButtonPaise(residentHome.html) === 3800n && !residentHome.text.includes("days overdue"), `button ${payButtonPaise(residentHome.html) ?? "missing"}`);

  const big = await findQueuedRow(staffCookie, "N710000000007");
  const asked = big ? await api("POST", `/api/bank-rows/${big.id}/ignore`, staffCookie, { reason: "Looks like a vendor refund, not maintenance", expectedVersion: 1 }) : null;
  check("an ignore of the ₹30,000 credit (above the demo's ₹10,000 threshold, D116) is 200 AWAITING_APPROVAL, not decided", asked?.status === 200 && asked.json?.status === "AWAITING_APPROVAL" && asked.json.thresholdPaise === "1000000", `status ${asked?.status}`);
  const high = await findQueuedRow(staffCookie, "730000000001");
  const highReview = high ? await api("GET", `/api/bank-rows/${high.id}`, staffCookie) : null;
  const highCandidate = highReview?.json?.candidates?.[0];
  const highDue = highCandidate?.openPositions?.[0]?.amountDuePaise;
  const matchAsked = high && highCandidate ? await api("POST", `/api/bank-rows/${high.id}/match`, staffCookie, { flatCode: highCandidate.flatCode, reason: "The code and the name agree with the flat", rememberPayer: false, expectedVersion: highReview.json.version, expectedAmountDuePaise: highDue }) : null;
  check("a MANUAL MATCH of a queued credit of ₹10,000 or more is 200 AWAITING_APPROVAL, not posted (D116)", matchAsked?.status === 200 && matchAsked.json?.status === "AWAITING_APPROVAL" && matchAsked.json.thresholdPaise === "1000000", `status ${matchAsked?.status}`);
  const awaiting = await api("GET", `/api/statements/${sampleImportId}/rows?lane=AWAITING_APPROVAL`, staffCookie);
  check("the AWAITING_APPROVAL lane holds those two rows", awaiting.json?.items?.length === 2 && awaiting.json.items.some((r) => r.id === big?.id) && awaiting.json.items.some((r) => r.id === high?.id) && awaiting.json.laneCounts.AWAITING_APPROVAL === 2, `status ${awaiting.status}`);
  const noPermission = big ? await api("POST", `/api/bank-rows/${big.id}/approve`, staffCookie, {}) : null;
  check("the person who asked (payments:match only) cannot approve: 403", noPermission?.status === 403, `status ${noPermission?.status}`);
  const approved = big ? await api("POST", `/api/bank-rows/${big.id}/approve`, second, { note: "Checked on the statement" }) : null;
  check("the second staff user approves: 200 APPROVED", approved?.status === 200 && approved.json?.status === "APPROVED" && approved.json.action === "IGNORE", `status ${approved?.status}`);
  const selfApproval = high ? await api("POST", `/api/bank-rows/${high.id}/approve`, staffCookie, {}) : null;
  check("the person who asked for the match cannot approve it either: 403", selfApproval?.status === 403, `status ${selfApproval?.status}`);
  const matchApproved = high ? await api("POST", `/api/bank-rows/${high.id}/approve`, second, { note: "Checked the code and the name" }) : null;
  check(
    "the second staff user approves the match: 200 APPROVED, a LATE_FEE and ONE PAYMENT of the principal, the late fee still owing",
    matchApproved?.status === 200 && matchApproved.json?.status === "APPROVED" && matchApproved.json.action === "MATCH" && matchApproved.json.entries?.length === 2 && matchApproved.json.entries[0].entryType === "LATE_FEE" && matchApproved.json.entries[1].entryType === "PAYMENT" && matchApproved.json.remaining?.kind === "FEE_ONLY",
    `status ${matchApproved?.status}`,
  );
  const finalLanes = await api("GET", `/api/statements/${sampleImportId}/rows?lane=NOT_MAINTENANCE&limit=1`, staffCookie);
  check("the lanes now: NEEDS_YOU 41, AWAITING_APPROVAL 0, MATCHED 26, NOT_MAINTENANCE 39 (106 rows in all)", JSON.stringify(finalLanes.json?.laneCounts) === JSON.stringify({ NEEDS_YOU: 41, AWAITING_APPROVAL: 0, MATCHED: 26, NOT_MAINTENANCE: 38 + 1 }), JSON.stringify(finalLanes.json?.laneCounts));
  const found = await api("GET", "/api/flats/search?q=T21-16", staffCookie);
  check("GET /api/flats/search?q=T21-16 finds T21-1601 with its resident and no phone number", found.status === 200 && found.json.flats.some((f) => f.flatCode === "T21-1601" && f.residents.includes("Aamir Shaikh")) && !JSON.stringify(found.json).match(/[0-9]{10}/), `status ${found.status}`);

  const denied = await Promise.all([
    api("GET", "/api/statements", residentCookie),
    api("GET", `/api/statements/${sampleImportId}/rows`, residentCookie),
    api("GET", `/api/bank-rows/${first?.id}`, residentCookie),
    api("GET", "/api/flats/search?q=T12", residentCookie),
    api("POST", `/api/bank-rows/${first?.id}/match`, residentCookie, { flatCode: "T12-0408", reason: "A reason here", rememberPayer: false, expectedVersion: 1 }),
    api("POST", `/api/bank-rows/${first?.id}/approve`, residentCookie, {}),
  ]);
  check("a resident gets 403 on every reconciliation route", denied.every((r) => r.status === 403), denied.map((r) => r.status).join(" "));
  await post("/api/auth/logout-all", undefined, second);
}

try {
  await run();
} catch (error) {
  check("the server could be reached", false, error instanceof Error ? error.message.slice(0, 120) : "network error");
}

const width = Math.max(...results.map((r) => r.name.length));
console.log(`smoke:app against ${baseUrl}`);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? `\nALL ${results.length} CHECKS PASSED` : `\n${failed} OF ${results.length} CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);
