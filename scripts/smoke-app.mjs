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
import { readinessFirst } from "./smoke-readiness.mjs";

const args = process.argv.slice(2);
const baseUrl = (args.find((a) => /^https?:\/\//.test(a)) ?? process.env.BASE_URL ?? "").replace(/\/+$/, "");
const asOfArg = (args.find((a) => a.startsWith("--as-of=")) ?? "--as-of=real").slice("--as-of=".length);
const expectDemoNote = (args.find((a) => a.startsWith("--demo=")) ?? "--demo=false").slice("--demo=".length) === "true";
if (!baseUrl || !(asOfArg === "real" || /^\d{4}-\d{2}-\d{2}$/.test(asOfArg))) {
  console.error("Usage: node scripts/smoke-app.mjs <BASE_URL> --as-of=<YYYY-MM-DD|real> --demo=<true|false>");
  process.exit(2);
}

// Readiness first (D112): a misconfigured deployment is named here, before a login is tried.
if (!(await readinessFirst(baseUrl, "smoke:app"))) process.exit(1);

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

  const anonymousReport = redirectTarget(await get("/staff/reports"));
  check("GET /staff/reports without a cookie goes to /login with a returnTo", anonymousReport?.to === "/login?returnTo=%2Fstaff%2Freports", anonymousReport ? `${anonymousReport.how} -> ${anonymousReport.to}` : "no redirect");

  // The committee report, read first: nothing has changed the pristine seed yet, so the October figures are the ones raw SQL gives (tests/integration/committee-report.test.ts).
  await committeeReportBeforeChanges();

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
  const reportForbidden = redirectTarget(await get("/staff/reports", cookie));
  check("a resident requesting /staff/reports ends at /forbidden", reportForbidden?.to === "/forbidden", reportForbidden ? `${reportForbidden.how} -> ${reportForbidden.to}` : "no redirect");
  const drillForbidden = redirectTarget(await get("/staff/reports?period=2026-10&bucket=31-60", cookie));
  check("a resident requesting a drill-down of the report ends at /forbidden too", drillForbidden?.to === "/forbidden", drillForbidden ? `-> ${drillForbidden.to}` : "no redirect");
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
  const accountsReport = redirectTarget(await get("/staff/reports", staffCookie));
  check("staff without reports:view (Priya Nair) requesting /staff/reports end at /forbidden", accountsReport?.to === "/forbidden", accountsReport ? `${accountsReport.how} -> ${accountsReport.to}` : "no redirect");
  check("the staff landing page of Priya Nair has no Committee report tool", !staff.html.includes('href="/staff/reports"'), "");
  const staffHome = redirectTarget(await get("/", staffCookie));
  check("GET / as staff goes to /staff", staffHome?.to === "/staff", staffHome ? `${staffHome.how} -> ${staffHome.to}` : "no redirect");
  if (expectDemoNote && paidCheckoutPath !== null) {
    const staffCheckout = redirectTarget(await get(paidCheckoutPath, staffCookie));
    check("a staff member opening the demo checkout is sent to /forbidden (a real 307)", staffCheckout?.to === "/forbidden" && staffCheckout.how.startsWith("307"), staffCheckout ? `${staffCheckout.how} -> ${staffCheckout.to}` : "no redirect");
    const staffPay = await post("/api/payments", { expectedAmountPaise: "100" }, staffCookie);
    check("a staff member calling POST /api/payments gets 403", staffPay.status === 403, `status ${staffPay.status}`);
  }
  if (expectDemoNote) await staffImportsSample(staffCookie);
  if (expectDemoNote) await committeeReportAfterImport();
  if (expectDemoNote && paidCheckoutPath !== null) await partPaidResidentFails(paidCheckoutPath, staffCookie, cookie);
  await post("/api/auth/logout-all", undefined, staffCookie);
  if (meeraCookie !== null) await post("/api/auth/logout-all", undefined, meeraCookie);
}

let paidCheckoutPath = null;
let meeraCookie = null;
let sampleImportId = null;

/**
 * Staff upload the sample statement (src/server/statements/sample-statement.ts, read with Node's type stripping). The T12-0408 resident paid
 * through the gateway earlier in this script, so that flat's bank row is queued, not posted: the gateway and the bank never both pay one bill.
 * Every other number is the sample's own (docs/statement-import-design.md).
 */
async function staffImportsSample(staffCookie) {
  const { getSampleStatement } = await import("../src/server/statements/sample-statement.ts");
  const csv = getSampleStatement();
  const first = await post("/api/statements/sample", undefined, staffCookie);
  const s = first.json?.summary ?? {};
  check(
    "POST /api/statements/sample (the demo route): 200, 106 rows, 24 posted, 44 queued, 38 ignored, none repeated, accounted true",
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
async function partPaidResidentFails(otherCheckoutPath, staffCookie, otherFlatCookie) {
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
  await complaints(cookie, staffCookie, otherFlatCookie);
  await post("/api/auth/logout-all", undefined, cookie);
}

/**
 * The complaints routes (CL9), as the T12-0408 resident, Kavita Rao (5000000004, complaints:manage) and Sanjay Pawar (5000000005, the duty manager).
 * The server runs with the real keyword fallback and no model (NullClassifier). It needs a database where these two texts have not been raised
 * yet, like the rest of this script (a repeat of the same text by the same person is the same complaint while the clock is frozen).
 */
async function complaints(residentCookie, staffCookie, otherFlatCookie) {
  const kavita = await login("5000000004");
  const sanjay = await login("5000000005");
  check("login as Kavita Rao (complaints:manage) and Sanjay Pawar (complaints:duty_manager)", kavita !== null && sanjay !== null, "");
  if (kavita === null || sanjay === null) return;

  const leak = await api("POST", "/api/complaints", residentCookie, { body: "Water leak under the sink" });
  const leakId = leak.json?.complaint?.id;
  check(
    "POST /api/complaints 'Water leak under the sink': 201, PLUMBING and an assignee from the keyword fallback, NORMAL, ASSIGNED, not a safety complaint",
    leak.status === 201 && leak.json?.complaint?.category === "PLUMBING" && leak.json.complaint.assigned === true && leak.json.complaint.status === "ASSIGNED" && leak.json.complaint.urgency === "NORMAL" && leak.json.complaint.safetyFlag === false,
    `status ${leak.status}`,
  );
  const gas = await api("POST", "/api/complaints", residentCookie, { body: "gas smell in the corridor" });
  const gasId = gas.json?.complaint?.id;
  check("POST /api/complaints 'gas smell in the corridor': 201, CRITICAL, a safety complaint, assigned at once", gas.status === 201 && gas.json?.complaint?.urgency === "CRITICAL" && gas.json.complaint.safetyFlag === true && gas.json.complaint.status === "ASSIGNED" && gas.json.complaint.assigned === true, `status ${gas.status}`);

  const lane = await api("GET", "/api/staff/complaints?lane=SAFETY&limit=50", sanjay);
  const onBoard = lane.json?.rows?.find((r) => r.id === gasId);
  check("the SAFETY lane of the staff board shows it for the duty manager, Sanjay Pawar, as CRITICAL with the source RULE", lane.status === 200 && onBoard?.assignee?.name === "Sanjay Pawar" && onBoard.urgency === "CRITICAL" && onBoard.source === "RULE", `status ${lane.status}`);
  const ack = await api("POST", `/api/staff/complaints/${gasId}/acknowledge`, sanjay, {});
  check("the duty manager acknowledges it: 200", ack.status === 200, `status ${ack.status}`);
  const notManager = await api("POST", `/api/staff/complaints/${gasId}/close`, kavita, { note: "Gas isolated and checked" });
  check("a staff user with only complaints:manage cannot close a safety complaint: 403", notManager.status === 403, `status ${notManager.status}`);
  const closed = await api("POST", `/api/staff/complaints/${gasId}/close`, sanjay, { note: "Gas isolated and checked" });
  check("the duty manager closes it: 200 CLOSED", closed.status === 200 && closed.json?.complaint?.status === "CLOSED", `status ${closed.status}`);
  const afterClose = await api("GET", "/api/staff/complaints?lane=SAFETY&limit=50", sanjay);
  check("it has left the SAFETY lane", afterClose.status === 200 && !afterClose.json.rows.some((r) => r.id === gasId), "");

  const detail = await api("GET", `/api/staff/complaints/${leakId}`, kavita);
  const resolved = await api("POST", `/api/staff/complaints/${leakId}/status`, kavita, { status: "PENDING_CONFIRMATION", note: "Pipe replaced", expectedVersion: detail.json?.complaint?.version });
  check("a staff user marks the water leak resolved: 200 PENDING_CONFIRMATION", detail.status === 200 && resolved.status === 200 && resolved.json?.complaint?.status === "PENDING_CONFIRMATION", `status ${resolved.status}`);
  const stale = await api("POST", `/api/staff/complaints/${leakId}/status`, kavita, { status: "IN_PROGRESS", expectedVersion: detail.json?.complaint?.version });
  check("the same version again is 409 (stale)", stale.status === 409, `status ${stale.status}`);
  const mine = await api("GET", `/api/complaints/${leakId}`, residentCookie);
  check("the resident sees it waiting for their answer, with a timeline and no staff names", mine.status === 200 && mine.json?.complaint?.needsAnswer === true && !JSON.stringify(mine.json).includes("Kavita"), `status ${mine.status}`);
  const confirmed = await api("POST", `/api/complaints/${leakId}/confirm`, residentCookie, { rating: 5 });
  check("the resident confirms with a rating: 200 CLOSED", confirmed.status === 200 && confirmed.json?.complaint?.status === "CLOSED" && confirmed.json.complaint.rating === 5, `status ${confirmed.status}`);
  const again = await api("POST", `/api/complaints/${leakId}/confirm`, residentCookie, {});
  check("a repeated confirm is 409", again.status === 409, `status ${again.status}`);

  const denied = await Promise.all([
    api("GET", "/api/staff/complaints", residentCookie),
    api("GET", `/api/staff/complaints/${leakId}`, residentCookie),
    api("GET", "/api/staff/users", residentCookie),
    api("POST", `/api/staff/complaints/${leakId}/assign`, residentCookie, { assigneeUserId: "00000000-0000-4000-8000-000000000000", expectedVersion: 1 }),
    api("POST", `/api/staff/complaints/${gasId}/close`, residentCookie, { note: "Closing this" }),
  ]);
  check("a resident gets 403 on the staff complaint routes", denied.every((r) => r.status === 403), denied.map((r) => r.status).join(" "));
  const staffOnResidentRoute = await api("POST", "/api/complaints", kavita, { body: "Water leak under the sink" });
  check("staff get 403 on the resident's raise route", staffOnResidentRoute.status === 403, `status ${staffOnResidentRoute.status}`);
  await complaintScreens(residentCookie, staffCookie, otherFlatCookie, kavita, sanjay);
  await post("/api/auth/logout-all", undefined, kavita);
  await post("/api/auth/logout-all", undefined, sanjay);
}

/** The Pay button of the Home with its classes: outlined (a border, no accent fill) or filled. Null when there is none. */
function payButtonStyle(html) {
  const match = /<button[^>]*class="([^"]*)"[^>]*>Pay (?:oldest bill )?₹[0-9,]+<\/button>/.exec(html);
  return match === null ? null : match[1].includes("bg-accent") ? "filled" : "outlined";
}

/**
 * The complaint SCREENS over HTTP (T13b), as the T21-1601 resident (the part-paid flat, so a Pay button exists), Sanjay Pawar (the duty manager,
 * 5000000005: the fifth staff phone of the seed, docs/seed-data.md A6), Kavita Rao (complaints:manage), staff without a complaint role, and the
 * T12-0408 resident (another flat). The sessions are the ones `complaints` opened (a code is not asked for again within its wait). It needs a
 * database where these two texts have not been raised yet (a repeat within the frozen clock is the same complaint). It prints no code, cookie or token.
 */
async function complaintScreens(residentCookie, staffCookie, neighbour, kavita, sanjay) {

  const form = await get("/complaints/new", residentCookie);
  check(
    "GET /complaints/new: 200, one h1, the danger question with Yes and No, and NO answer pre-selected",
    form.status === 200 && (form.html.match(/<h1/g) ?? []).length === 1 && form.text.includes("Is anyone in danger right now?") && (form.html.match(/type="radio"/g) ?? []).length === 2 && !/checked(=|\s|>)/.test(form.html),
    `status ${form.status}`,
  );
  check("the form's one filled control is 'Send complaint'", /<button[^>]*bg-accent[^>]*>Send complaint<\/button>/.test(form.html), "");
  const list = await get("/complaints", residentCookie);
  check("GET /complaints: 200, one h1, the 'Raise a complaint' link to /complaints/new", list.status === 200 && (list.html.match(/<h1/g) ?? []).length === 1 && /href="\/complaints\/new"/.test(list.html) && list.text.includes("Raise a complaint"), `status ${list.status}`);

  const before = await get("/", residentCookie);
  check("before any danger report the Home has no safety alert and Pay is filled", !before.text.includes("report has gone to the duty manager") && payButtonStyle(before.html) === "filled", `pay ${payButtonStyle(before.html)}`);

  const danger = await api("POST", "/api/complaints", residentCookie, { body: "Bench near the tower 2 gate needs paint", declaredDanger: true });
  const dangerId = danger.json?.complaint?.id;
  check("POST /api/complaints with declaredDanger true and innocuous text: 201, CRITICAL, a safety complaint", danger.status === 201 && danger.json?.complaint?.safetyFlag === true && danger.json.complaint.urgency === "CRITICAL", `status ${danger.status}`);
  if (typeof dangerId !== "string") return;

  const alert1a = await get("/", residentCookie);
  check(
    "GET / shows alert 1a above the dues with a tel: Call duty manager link, and the Pay button is OUTLINED",
    alert1a.text.includes("Your report has gone to the duty manager") && alert1a.text.includes("If anyone is in danger, call now.") && /<a [^>]*href="tel:5900000001"[^>]*>(?:<svg[\s\S]*?<\/svg>)?Call duty manager<\/a>/.test(alert1a.html) && alert1a.html.indexOf("report has gone to the duty manager") < alert1a.html.indexOf("Amount due, as of") && payButtonStyle(alert1a.html) === "outlined",
    `pay ${payButtonStyle(alert1a.html)}`,
  );
  check("before the acknowledgement the Home does NOT say the duty manager has seen the report", !alert1a.text.includes("has seen your report"), "");
  await staffSafetyBeforeAck(dangerId, kavita, sanjay, staffCookie, residentCookie);

  const ack = await api("POST", `/api/staff/complaints/${dangerId}/acknowledge`, sanjay, {});
  check("the duty manager acknowledges through the existing route: 200", ack.status === 200, `status ${ack.status}`);
  const alert1b = await get("/", residentCookie);
  check("GET / then shows alert 1b: 'The duty manager has seen your report' with 'Seen at <time>', and Pay is still outlined", alert1b.text.includes("The duty manager has seen your report") && /Seen at \d{1,2}(:\d{2})? (am|pm)\./.test(alert1b.text) && payButtonStyle(alert1b.html) === "outlined", "");
  await staffSafetyAfterAck(dangerId, kavita, sanjay);

  const safetyDetail = await get(`/complaints/${dangerId}`, residentCookie);
  check(
    "a safety complaint's page: 200, one h1, no auto-close line, no 'Yes, it's fixed', no 'Is it fixed?'",
    safetyDetail.status === 200 && (safetyDetail.html.match(/<h1/g) ?? []).length === 1 && !safetyDetail.text.includes("closes by itself") && !safetyDetail.text.includes("Yes, it's fixed") && !safetyDetail.text.includes("Is it fixed?"),
    `status ${safetyDetail.status}`,
  );

  const normal = await api("POST", "/api/complaints", residentCookie, { body: "Stairwell light on floor 4 is flickering", declaredDanger: false });
  const normalId = normal.json?.complaint?.id;
  check("a normal complaint: 201, not a safety complaint", normal.status === 201 && normal.json?.complaint?.safetyFlag === false, `status ${normal.status}`);
  if (typeof normalId !== "string") return;
  const open = await get(`/complaints/${normalId}`, residentCookie);
  check("its page before staff resolve it has the tracker and no confirm buttons", open.status === 200 && open.text.includes("Stairwell light on floor 4 is flickering") && open.html.includes('aria-label="Complaint progress"') && !open.text.includes("Yes, it's fixed"), `status ${open.status}`);
  await staffCommentsAndOpenLane(normalId, residentCookie, kavita);

  const staffView = await api("GET", `/api/staff/complaints/${normalId}`, kavita);
  const resolved = await api("POST", `/api/staff/complaints/${normalId}/status`, kavita, { status: "PENDING_CONFIRMATION", note: "Bulb replaced", expectedVersion: staffView.json?.complaint?.version });
  check("staff mark it resolved: 200", resolved.status === 200, `status ${resolved.status}`);
  await staffWaitingLane(normalId, kavita);
  const asking = await get(`/complaints/${normalId}`, residentCookie);
  check(
    "its page then asks 'Is it fixed?' with 'Yes, it's fixed' and 'No, still a problem' and the auto-close line of 7 days",
    asking.text.includes("Is it fixed?") && asking.text.includes("Yes, it's fixed") && asking.text.includes("No, still a problem") && asking.text.includes("It closes by itself after 7 days if you don't answer."),
    "",
  );
  const confirmed = await api("POST", `/api/complaints/${normalId}/confirm`, residentCookie, { rating: 4 });
  check("confirming through the route the button calls: 200 CLOSED", confirmed.status === 200 && confirmed.json?.complaint?.status === "CLOSED", `status ${confirmed.status}`);
  const closedPage = await get(`/complaints/${normalId}`, residentCookie);
  check("its page then says 'Closed. You confirmed it is fixed.' with no buttons", closedPage.text.includes("Closed. You confirmed it is fixed.") && !closedPage.html.includes("<button"), "");
  const afterList = await get("/complaints", residentCookie);
  check("GET /complaints lists the closed one in a collapsed 'Closed (n)' section", /<details(?![^>]*\sopen)[^>]*><summary[^>]*>Closed \(\d+\)<\/summary>/.test(afterList.html), "");

  const foreign = await get(`/complaints/${normalId}`, neighbour);
  const missing = await get("/complaints/00000000-0000-4000-8000-000000000000", neighbour);
  check(
    "a resident of another flat requesting this complaint gets the not-found page (no title, no text of it), the same as a missing id",
    foreign.text.includes("We can't find that complaint") && !foreign.text.includes("Stairwell light") && missing.text.includes("We can't find that complaint") && foreign.status === missing.status,
    `status ${foreign.status} and ${missing.status}`,
  );
  const foreignHome = await get("/", neighbour);
  check("a resident of another flat never sees the alert on their own Home", !foreignHome.text.includes("report has gone to the duty manager") && !foreignHome.text.includes("has seen your report"), "");

  const staffList = redirectTarget(await get("/complaints", staffCookie));
  const staffNew = redirectTarget(await get("/complaints/new", staffCookie));
  check("staff requesting /complaints or /complaints/new are redirected to /forbidden", staffList?.to === "/forbidden" && staffNew?.to === "/forbidden", `${staffList?.how} -> ${staffList?.to}`);
  const anonymous = redirectTarget(await get("/complaints"));
  check("nobody signed in is sent to /login with a returnTo", /^\/login\?returnTo=/.test(anonymous?.to ?? ""), `${anonymous?.how} -> ${anonymous?.to}`);
}

/** The HTML of the first row of a lane table, or "" when the lane is empty. */
function firstRow(html) {
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
  return body.split("<tr ")[1] ?? "";
}
const tabCount = (html, label) => {
  const match = new RegExp(`>${label}<span[^>]*>(\\d+)</span>`).exec(html);
  return match ? Number(match[1]) : null;
};
const selectedTab = (html) => /<a [^>]*id="complaints-tab-([A-Z_]+)"[^>]*aria-selected="true"/.exec(html)?.[1] ?? null;
const hasWord = (html, word) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").includes(word);

/**
 * The staff complaint SCREENS over HTTP (T13c), before the duty manager acknowledges the declared-danger complaint: the board for the duty manager, a plain
 * manager, staff without complaints:manage and a resident; the landing tool; the Safety lane; and the page of the complaint with the two safety controls.
 */
async function staffSafetyBeforeAck(dangerId, kavita, sanjay, accountsStaff, residentCookie) {
  const landing = await get("/staff", kavita);
  check("GET /staff as Kavita Rao lists the Complaints tool with the number of open safety complaints", landing.status === 200 && /<a [^>]*href="\/staff\/complaints"[^>]*>Complaints<\/a>/.test(landing.html) && /\d+ open safety complaints?/.test(landing.text), `status ${landing.status}`);
  const accountsLanding = await get("/staff", accountsStaff);
  check("GET /staff as an accounts-only staff member has no Complaints tool", accountsLanding.status === 200 && !accountsLanding.html.includes('href="/staff/complaints"'), "");

  const plain = await get("/staff/complaints", kavita);
  check(
    "GET /staff/complaints as Kavita Rao (complaints:manage): 200, one h1, six lane tabs with counts, Needs triage selected",
    plain.status === 200 && (plain.html.match(/<h1/g) ?? []).length === 1 && (plain.html.match(/role="tab"/g) ?? []).length === 6 && ["Needs triage", "Safety", "Open", "Overdue", "Waiting for resident", "Closed"].every((l) => tabCount(plain.html, l) !== null) && selectedTab(plain.html) === "NEEDS_TRIAGE",
    `status ${plain.status}, selected ${selectedTab(plain.html)}`,
  );
  const duty = await get("/staff/complaints", sanjay);
  check("GET /staff/complaints as the duty manager opens on the Safety lane, which has items", duty.status === 200 && selectedTab(duty.html) === "SAFETY" && (tabCount(duty.html, "Safety") ?? 0) >= 1, `selected ${selectedTab(duty.html)}`);
  const safety = await get("/staff/complaints?lane=safety", sanjay);
  const row = firstRow(safety.html);
  check("the Safety lane shows the declared-danger complaint FIRST, as Critical with the source Rules and Sanjay Pawar as assignee", row.includes("Bench near the tower 2 gate needs paint") && hasWord(row, "Critical") && hasWord(row, "Rules") && hasWord(row, "Sanjay Pawar"), "");

  const forbidden = await get("/staff/complaints", residentCookie);
  const forbiddenPage = redirectTarget(forbidden);
  check("a resident requesting /staff/complaints ends at /forbidden", forbiddenPage?.to === "/forbidden", forbiddenPage ? `${forbiddenPage.how} -> ${forbiddenPage.to}` : `status ${forbidden.status}, no redirect`);
  const forbiddenDetail = redirectTarget(await get(`/staff/complaints/${dangerId}`, residentCookie));
  check("a resident requesting a complaint page of the staff screens ends at /forbidden", forbiddenDetail?.to === "/forbidden", forbiddenDetail ? `-> ${forbiddenDetail.to}` : "no redirect");
  const accountsBoard = redirectTarget(await get("/staff/complaints", accountsStaff));
  check("staff without complaints:manage requesting /staff/complaints end at /forbidden", accountsBoard?.to === "/forbidden", accountsBoard ? `-> ${accountsBoard.to}` : "no redirect");
  const anonymousBoard = redirectTarget(await get("/staff/complaints"));
  check("nobody signed in is sent to /login with a returnTo", /^\/login\?returnTo=/.test(anonymousBoard?.to ?? ""), anonymousBoard ? `-> ${anonymousBoard.to}` : "no redirect");

  const dutyPage = await get(`/staff/complaints/${dangerId}`, sanjay);
  check(
    "the complaint page for the duty manager: 200, one h1, the full text, 'I have seen this' (filled) and 'Close this safety complaint', no 'Mark resolved'",
    dutyPage.status === 200 && (dutyPage.html.match(/<h1/g) ?? []).length === 1 && dutyPage.text.includes("Bench near the tower 2 gate needs paint") && /<button[^>]*bg-accent[^>]*>I have seen this<\/button>/.test(dutyPage.html) && dutyPage.text.includes("Close this safety complaint") && !dutyPage.text.includes("Mark resolved") && (dutyPage.html.match(/bg-accent/g) ?? []).length === 1,
    `status ${dutyPage.status}`,
  );
  check("it shows the full timeline with the internal classification marked Internal and the escalation marked visible", dutyPage.text.includes("Classified by Rules") && dutyPage.text.includes("Sent to the duty manager") && dutyPage.text.includes("Internal") && dutyPage.text.includes("Visible to the resident"), "");
  const managerPage = await get(`/staff/complaints/${dangerId}`, kavita);
  check("the same page for a plain manager (Kavita Rao): neither 'I have seen this' nor 'Close this safety complaint', and no 'Mark resolved'", managerPage.status === 200 && !managerPage.text.includes("I have seen this") && !managerPage.text.includes("Close this safety complaint") && !managerPage.text.includes("Mark resolved"), `status ${managerPage.status}`);
}

/** After the acknowledgement: the first control is gone and the page says when it was seen. */
async function staffSafetyAfterAck(dangerId, kavita, sanjay) {
  const after = await get(`/staff/complaints/${dangerId}`, sanjay);
  check("after the acknowledgement the duty manager's page has no 'I have seen this', nothing filled, and says when it was seen", !after.text.includes("I have seen this") && !after.html.includes("bg-accent") && after.text.includes("The duty manager saw this at") && after.text.includes("Close this safety complaint"), "");
  const still = await get(`/staff/complaints/${dangerId}`, kavita);
  check("a plain manager still sees neither control after it", !still.text.includes("I have seen this") && !still.text.includes("Close this safety complaint"), "");
}

/** An internal comment is on the staff page and NOT on the resident's page; a visible one is on both. The complaint is in the Open lane. */
async function staffCommentsAndOpenLane(normalId, residentCookie, kavita) {
  const open = await get("/staff/complaints?lane=open", kavita);
  check("the Open lane of the board lists the new ordinary complaint", open.status === 200 && open.text.includes("Stairwell light on floor 4 is flickering"), `status ${open.status}`);
  const internal = await api("POST", `/api/staff/complaints/${normalId}/comment`, kavita, { text: "Internal note: electrician booked for Friday", visibleToResident: false });
  const visible = await api("POST", `/api/staff/complaints/${normalId}/comment`, kavita, { text: "An electrician will visit on Friday", visibleToResident: true });
  check("staff post an internal comment and a visible one: 200 and 200", internal.status === 200 && visible.status === 200, `${internal.status} ${visible.status}`);
  const staffPage = await get(`/staff/complaints/${normalId}`, kavita);
  check(
    "the staff page shows both comments, the internal one marked Internal and the visible one 'Comment, visible to the resident'",
    staffPage.text.includes("Internal note: electrician booked for Friday") && staffPage.text.includes("An electrician will visit on Friday") && staffPage.text.includes("Comment, internal") && staffPage.text.includes("Comment, visible to the resident"),
    "",
  );
  const residentPage = await get(`/complaints/${normalId}`, residentCookie);
  check("the resident's page does NOT show the internal comment and DOES show the visible one", !residentPage.text.includes("Internal note") && !residentPage.text.includes("electrician booked") && residentPage.text.includes("An electrician will visit on Friday"), "");
  check("the staff page offers 'Mark in progress' and 'Mark resolved', the comment box with the visible box unchecked, and the category control", staffPage.text.includes("Mark in progress") && staffPage.text.includes("Mark resolved") && /<input[^>]*id="comment-visible"[^>]*type="checkbox"/.test(staffPage.html) && !/<input[^>]*id="comment-visible"[^>]*checked/.test(staffPage.html) && staffPage.text.includes("Correct the category"), "");
}

/** A complaint that staff marked resolved is in "Waiting for resident" and no longer in Open. */
async function staffWaitingLane(normalId, kavita) {
  const waiting = await get("/staff/complaints?lane=waiting", kavita);
  check("marking the ordinary complaint resolved puts it in the 'Waiting for resident' lane, which is selected", waiting.status === 200 && selectedTab(waiting.html) === "WAITING_RESIDENT" && waiting.text.includes("Stairwell light on floor 4 is flickering") && hasWord(firstRow(waiting.html) + (waiting.html.split("<li ")[1] ?? ""), "Waiting for resident"), `status ${waiting.status}`);
  const open = await get("/staff/complaints?lane=open", kavita);
  check("and it has left the Open lane", !open.text.includes("Stairwell light on floor 4 is flickering"), "");
}

/** An amount as the page prints it ("₹1,80,52,190" or "₹6,468.50"), in paise. */
function paiseOf(text) {
  const [rupeesPart, paisePart = ""] = text.replace(/[₹,]/g, "").split(".");
  return BigInt(rupeesPart) * 100n + BigInt(paisePart.padEnd(2, "0").slice(0, 2));
}

const BUCKET_LABELS = ["Not yet due", "1 to 30 days", "31 to 60 days", "61 to 90 days", "Over 90 days"];
/** The five age groups of the ageing block: label, flats, bills and the amount due in paise, read from the page's text. */
function ageingBuckets(text) {
  const from = text.indexOf("What is owed");
  return BUCKET_LABELS.map((label) => {
    const match = new RegExp(`${label} (\\d+) flats, (\\d+) bills (₹[\\d,.]+)`).exec(text.slice(from));
    return match ? { label, flats: Number(match[1]), bills: Number(match[2]), amountPaise: paiseOf(match[3]) } : null;
  });
}

/**
 * The committee report (T14) over HTTP as Meera Kapoor (reports:view; the third staff phone of the seed, docs/seed-data.md A6), read BEFORE any other check changes the
 * data, so it is the pristine seed. The October figures are the ones raw SQL gives for the seeded database as of 27 Oct 2026 (RP2 in
 * tests/integration/committee-report.test.ts pins them); they are checked exactly when the server's clock is frozen to that date, and otherwise only the shape
 * and the sums are. The ageing buckets must add up to the total on the page, whatever the date.
 */
async function committeeReportBeforeChanges() {
  meeraCookie = await login("5000000003");
  check("login as Meera Kapoor (reports:view)", meeraCookie !== null, meeraCookie ? `cookie length ${meeraCookie.length}` : "could not log in");
  if (meeraCookie === null) return;
  const landing = await get("/staff", meeraCookie);
  check("GET /staff as Meera Kapoor lists the Committee report tool", landing.status === 200 && /<a [^>]*href="\/staff\/reports"[^>]*>Committee report<\/a>/.test(landing.html), `status ${landing.status}`);
  const page = await get("/staff/reports?period=2026-10", meeraCookie);
  check("GET /staff/reports as Meera Kapoor: 200, one h1 'Committee report', the month selector, and a 'Figures as of' line in words", page.status === 200 && (page.html.match(/<h1/g) ?? []).length === 1 && /<h1[^>]*>Committee report<\/h1>/.test(page.html) && page.html.includes('id="report-period"') && /Figures as of \d{1,2} [A-Z][a-z]+ \d{4}\./.test(page.text), `status ${page.status}`);
  check("it names the month and has no money line of zeros: 'Money, October 2026'", page.text.includes("Money, October 2026"), "");
  const October = { billed: 1_805_219_000n, collected: 1_484_271_400n, outstanding: 320_947_600n };
  const money = {
    billed: new RegExp(`Billed (₹[\\d,.]+)`).exec(page.text)?.[1],
    collected: /Collected Principal paid, as of the date above\. A late fee is not in it\. (₹[\d,.]+)/.exec(page.text)?.[1],
    outstanding: /Outstanding Principal still owed\. (₹[\d,.]+)/.exec(page.text)?.[1],
  };
  const parsed = { billed: money.billed ? paiseOf(money.billed) : null, collected: money.collected ? paiseOf(money.collected) : null, outstanding: money.outstanding ? paiseOf(money.outstanding) : null };
  check("the money line is Billed = Collected + Outstanding, exactly, in paise, as printed on the page", parsed.billed !== null && parsed.collected !== null && parsed.outstanding !== null && parsed.billed === parsed.collected + parsed.outstanding, `${money.billed} = ${money.collected} + ${money.outstanding}`);
  if (frozenToTheBrief) {
    check(
      `the October money line equals the independently computed figures: Billed ${rupees(October.billed)}, Collected ${rupees(October.collected)}, Outstanding ${rupees(October.outstanding)}`,
      parsed.billed === October.billed && parsed.collected === October.collected && parsed.outstanding === October.outstanding,
      `${money.billed} ${money.collected} ${money.outstanding}`,
    );
    check("and the flat counts: 2399 billed, 1915 paid in full, 484 with principal outstanding (they add up)", page.text.includes("Flats billed 2399") && page.text.includes("Flats paid in full 1915") && page.text.includes("Flats with principal outstanding 484"), "");
  } else {
    check("the flat counts add up: paid in full + with principal outstanding = billed", (() => {
      const n = (label) => Number(new RegExp(`${label} (\\d+)`).exec(page.text)?.[1] ?? NaN);
      return n("Flats paid in full") + n("Flats with principal outstanding") === n("Flats billed") && n("Flats billed") > 0;
    })(), "");
  }
  check("the late-fee block names its three figures", page.text.includes("Posted and paid") && page.text.includes("Posted and owing") && page.text.includes("Accruing on open bills"), "");

  const buckets = ageingBuckets(page.text);
  check("the ageing block says it is all open dues of all months and shows the five age groups in order", page.text.includes("All open dues, all months") && buckets.every((b) => b !== null), JSON.stringify(buckets.map((b) => b?.label)));
  const total = /Total due (\d+) flats, (\d+) bills (₹[\d,.]+)/.exec(page.text.slice(page.text.indexOf("What is owed")));
  const bucketSum = buckets.reduce((sum, b) => sum + (b?.amountPaise ?? 0n), 0n);
  check("the five age groups add up to the total due and the total number of bills, exactly", total !== null && paiseOf(total[3]) === bucketSum && buckets.reduce((sum, b) => sum + (b?.bills ?? 0), 0) === Number(total[2]), total ? `${total[3]} = ${rupees(bucketSum)}` : "no total");
  if (frozenToTheBrief) check("the total equals the independently computed total: 943 open bills, ₹61,89,686 (the sum of every flat's amount due on its Home)", total !== null && Number(total[2]) === 943 && paiseOf(total[3]) === 618_968_600n, total ? `${total[2]} bills ${total[3]}` : "no total");

  check(
    "the complaints block, the collection quality block and the goals table are there",
    page.text.includes("Complaints, October 2026") && page.text.includes("Collection quality, October 2026") && page.text.includes("Replied within the SLA") && page.text.includes("Goals") && /At least 90%/.test(page.text) && /At most 8%/.test(page.text),
    "",
  );
  check("each goal says Met or Not met in words", (page.text.match(/\b(Met|Not met|No data)\b/g) ?? []).length >= 3, "");
  if (frozenToTheBrief) {
    check("the complaint figures equal the independently computed ones: 1603 raised, 16 safety, 290 open now", page.text.includes("Raised 1603") && page.text.includes("Open now 290") && /Safety complaints Raised 16/.test(page.text), "");
    check("a seeded safety complaint is not acknowledged, and the block says it is waiting for the duty manager", page.text.includes("1 safety complaint is waiting for the duty manager."), "");
  }
  check("the reconciliation line is there: before any import it says no statement was imported in the last 30 days", page.text.includes("Bank reconciliation, last 30 days") && page.text.includes("No bank statement was imported in the last 30 days."), "");

  const drill = await get("/staff/reports?period=2026-10&bucket=31-60", meeraCookie);
  const drillSection = drill.html.slice(drill.html.indexOf('id="ageing-detail"'));
  const rows = (drillSection.match(/<th scope="row"/g) ?? []).length;
  const first = /<tbody>[\s\S]*?<th scope="row"[^>]*>(T\d\d-\d{4})<\/th>\s*<td[^>]*>([A-Za-z]+ \d{4})<\/td>\s*<td[^>]*>(\d+)<\/td>/.exec(drill.html);
  check("GET /staff/reports?bucket=31-60 lists flats: 200, the heading, a table of 25 rows with flat code, bill month and days overdue, and Load more", drill.status === 200 && drill.text.includes("Open dues: 31 to 60 days") && rows === 25 && first !== null && Number(first[3]) >= 31 && Number(first[3]) <= 60 && drill.html.includes(">Load more</button>"), `status ${drill.status}, ${rows} rows, first ${first ? `${first[1]} ${first[2]} ${first[3]}` : "none"}`);
  const bucketBills = buckets[2]?.bills ?? 0;
  check("the number of bills of that age group on the page is more than one page of 25 (so Load more has something to load)", bucketBills > 25, `${bucketBills} bills`);
  const days = [...drillSection.matchAll(/<th scope="row"[^>]*>T\d\d-\d{4}<\/th>\s*<td[^>]*>[A-Za-z]+ \d{4}<\/td>\s*<td[^>]*>(\d+)<\/td>/g)].map((m) => Number(m[1]));
  check("the drill-down is oldest first", days.length === 25 && days.every((d, i) => i === 0 || days[i - 1] >= d), days.slice(0, 6).join(" "));
  const others = await Promise.all(["not-yet-due", "1-30", "61-90", "over-90"].map((b) => get(`/staff/reports?period=2026-10&bucket=${b}`, meeraCookie)));
  check("the other four age groups open too", others.every((r) => r.status === 200 && r.text.includes("Open dues:")), others.map((r) => r.status).join(" "));
  const everything = [page, drill, ...others].map((r) => r.text).join(" ");
  check("no resident name and no phone number is on the report or its drill-downs (the T12-0408 and T21-1601 residents, their phones, the staff)", !/Swati Joshi|Aamir Shaikh|Priya Nair|Rahul Menon|Kavita Rao|Sanjay Pawar|Meera Kapoor/.test(everything) && !/\b50000000\d\d\b|\b59000000\d\d\b/.test(everything), "");
  const badBucket = await get("/staff/reports?period=2026-10&bucket=nonsense", meeraCookie);
  check("an unknown bucket in the address shows the report and no drill-down", badBucket.status === 200 && !badBucket.html.includes('id="ageing-detail"') && badBucket.text.includes("Money, October 2026"), `status ${badBucket.status}`);
  const future = await get("/staff/reports?period=2099-01", meeraCookie);
  const futureText = future.html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, " ");
  check("a future month in the address is ignored: the report opens on a real month", future.status === 200 && !futureText.includes("2099") && futureText.includes("Money,"), `status ${future.status}`);
  const empty = await get("/staff/reports?period=2026-01", meeraCookie);
  check("a past month with no bills says 'No bills for this month' and still shows what is owed", empty.status === 200 && empty.text.includes("No bills for this month") && empty.text.includes("What is owed"), `status ${empty.status}`);
}

/** After the sample statement was imported (staffImportsSample): the reconciliation line has its rows, the share posted automatically and the accounted check. */
async function committeeReportAfterImport() {
  if (meeraCookie === null) return;
  const page = await get("/staff/reports?period=2026-10", meeraCookie);
  check("the reconciliation line then counts the sample statement: 106 bank rows, 24 posted automatically, 44 waiting for a person, 38 not maintenance", page.text.includes("Bank rows imported 106") && page.text.includes("Posted automatically 24") && page.text.includes("Waiting for a person 44") && page.text.includes("Not maintenance 38"), "");
  check("it gives the share posted automatically (24 of 106 bank rows, 23%) and says the import's rows all add up", page.text.includes("Share posted automatically 24 of 106 bank rows 23%") && /The rows of (the 1 import all|all \d+ imports) add up\./.test(page.text), "");
  check("the manual interventions table is there with its four decision types", ["Manual match", "Approved", "Rejected", "Ignored"].every((l) => page.text.includes(l)) && page.html.includes("Manual interventions in the last 30 days, by decision type"), "");
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

/** The text of a page with its tags and the hidden duplicate (table and cards) left as they are: a check looks for a phrase, not a position. */
const phrase = (page, text) => page.text.includes(text);

/**
 * The reconciliation SCREENS over HTTP (T12c): the start page, the workspace of the sample import (the books accounted for, the four lane counts),
 * the review panel for one row (?row=), the Awaiting approval lane as the requester and as another approver, and who is turned away.
 * Run before any manual action, so the counts are the import's own (the gateway already paid T12-0408, so one row fewer is posted).
 */
async function reconciliationScreens(staffCookie, residentCookie, rowId) {
  const start = await get("/staff/reconciliation", staffCookie);
  check("GET /staff/reconciliation as staff: 200, one h1, the upload panel, the sample button (demo mode) and the sample import in Recent imports", start.status === 200 && (start.html.match(/<h1/g) ?? []).length === 1 && phrase(start, "Upload a bank statement") && phrase(start, "Use the sample statement") && phrase(start, "Recent imports") && phrase(start, "sample-statement.csv"), `status ${start.status}`);
  const workspace = await get(`/staff/reconciliation/${sampleImportId}`, staffCookie);
  check("the workspace shows 'All 106 rows accounted for' (read back from the database), one h1 and the file name", workspace.status === 200 && phrase(workspace, "All 106 rows accounted for") && (workspace.html.match(/<h1/g) ?? []).length === 1 && phrase(workspace, "sample-statement.csv"), `status ${workspace.status}`);
  check(
    "the workspace shows the lane counts: Needs you 44, Awaiting approval 0, Posted 24, Not maintenance 38, and the summary numbers",
    ["Needs you 44", "Awaiting approval 0", "Posted 24", "Not maintenance 38", "Posted automatically 24", "Need you 44"].every((p) => phrase(workspace, p)),
    "",
  );
  check("the workspace is a tablist with four tabs and a tab panel, and has no accept-all or checkbox", (workspace.html.match(/role="tab"/g) ?? []).length === 4 && workspace.html.includes('role="tabpanel"') && !/accept all|approve all|post all|select all/i.test(workspace.text) && !workspace.html.includes('type="checkbox"'), "");
  const panel = await get(`/staff/reconciliation/${sampleImportId}?row=${rowId}`, staffCookie);
  check(
    "?row=<id> shows the review panel: the full narration, 'Why this needs you', the first candidate T21-1601 with its amount relation, and Post disabled",
    panel.status === 200 && phrase(panel, "Review this payment") && phrase(panel, "Why this needs you") && phrase(panel, "UPI/710000000003/T21-1601 Aamir Shaikh/maintenance") && phrase(panel, "T21-1601") && phrase(panel, "Equals the unpaid bill, ₹38 of late fee would still be due") && /<button[^>]*disabled[^>]*>Post<\/button>/.test(panel.html),
    `status ${panel.status}`,
  );
  check("the ₹5,660 row is below the demo threshold, so its panel has no second-approver notice", !phrase(panel, "second approver"), "");
  const posted = await get(`/staff/reconciliation/${sampleImportId}?lane=posted`, staffCookie);
  check("the Posted lane is read only: 'Automatic' rows, no button and no undo", posted.status === 200 && phrase(posted, "Automatic") && !/<button[^>]*>(Approve|Reject|Undo|Post)/.test(posted.html) && !/undo/i.test(posted.text), `status ${posted.status}`);

  const resident = await get(`/staff/reconciliation/${sampleImportId}`, residentCookie);
  const residentStart = await get("/staff/reconciliation", residentCookie);
  check("a resident requesting the workspace, or the start page, ends at /forbidden (a redirect, no staff data in the body)", redirectTarget(resident)?.to === "/forbidden" && redirectTarget(residentStart)?.to === "/forbidden" && !resident.text.includes("sample-statement") && !residentStart.text.includes("sample-statement"), `${redirectTarget(resident)?.how} -> ${redirectTarget(resident)?.to} / ${redirectTarget(residentStart)?.how} -> ${redirectTarget(residentStart)?.to}`);
  const reportsOnly = meeraCookie;
  const refused = reportsOnly === null ? null : await get(`/staff/reconciliation/${sampleImportId}`, reportsOnly);
  const refusedStart = reportsOnly === null ? null : await get("/staff/reconciliation", reportsOnly);
  check("staff without payments:match (Meera Kapoor, reports:view) are refused the workspace and the start page: /forbidden", refused !== null && redirectTarget(refused)?.to === "/forbidden" && redirectTarget(refusedStart)?.to === "/forbidden" && !refused.text.includes("sample-statement"), refused ? `${redirectTarget(refused)?.how} -> ${redirectTarget(refused)?.to}` : "could not log in");
  const noCookie = await get(`/staff/reconciliation/${sampleImportId}`);
  check("nobody signed in is sent to /login with a returnTo and sees no data", /^\/login\?returnTo=/.test(redirectTarget(noCookie)?.to ?? "") && !noCookie.text.includes("sample-statement"), `${redirectTarget(noCookie)?.how} -> ${redirectTarget(noCookie)?.to}`);
  const staffLanding = await get("/staff", staffCookie);
  check("the staff landing links to Bank reconciliation", /<a [^>]*href="\/staff\/reconciliation"/.test(staffLanding.html), "");
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
  await reconciliationScreens(staffCookie, residentCookie, principal.id);

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
  const asRequester = await get(`/staff/reconciliation/${sampleImportId}?lane=awaiting-approval`, staffCookie);
  const asApprover = await get(`/staff/reconciliation/${sampleImportId}?lane=awaiting-approval`, second);
  check(
    "the Awaiting approval lane: the requester sees who asked, what and why and 'Waiting for another approver' with no Approve or Reject; the other approver sees Approve and Reject",
    phrase(asRequester, "Asked by Priya Nair") && phrase(asRequester, "Match to") && phrase(asRequester, "The code and the name agree with the flat") && phrase(asRequester, "Waiting for another approver") && !/<button[^>]*>(Approve|Reject)<\/button>/.test(asRequester.html) && /<button[^>]*>Approve<\/button>/.test(asApprover.html) && /<button[^>]*>Reject<\/button>/.test(asApprover.html) && !phrase(asApprover, "Waiting for another approver"),
    `${asRequester.status} ${asApprover.status}`,
  );
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
