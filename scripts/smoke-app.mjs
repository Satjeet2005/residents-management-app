// Smoke test for the resident app pages over real HTTP. No dependencies: Node 24's fetch.
//
//   node scripts/smoke-app.mjs <BASE_URL> --as-of=2026-10-27 --demo=true     the server runs with DEMO_AS_OF=2026-10-27
//   node scripts/smoke-app.mjs <BASE_URL> --as-of=real --demo=true           the server uses the real India date
//   npm run smoke:app -- http://localhost:3100 --as-of=real --demo=false
//
// It logs in as the T12-0408 resident (5000000007, Swati Joshi) and as a staff member (5000000001, Priya Nair) of the
// demo data, and checks the pages. The expected numbers are worked out here, independently of the app, with BigInt.
// It never prints a code, a token or a cookie, only lengths.

const args = process.argv.slice(2);
const baseUrl = (args.find((a) => /^https?:\/\//.test(a)) ?? process.env.BASE_URL ?? "").replace(/\/+$/, "");
const asOfArg = (args.find((a) => a.startsWith("--as-of=")) ?? "--as-of=real").slice("--as-of=".length);
const expectDemoNote = (args.find((a) => a.startsWith("--demo=")) ?? "--demo=false").slice("--demo=".length) === "true";
if (!baseUrl || !(asOfArg === "real" || /^\d{4}-\d{2}-\d{2}$/.test(asOfArg))) {
  console.error("Usage: node scripts/smoke-app.mjs <BASE_URL> --as-of=<YYYY-MM-DD|real> --demo=<true|false>");
  process.exit(2);
}

const RESIDENT = "5000000007";
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
  check(`GET / labels the date: 'As of ${asOfText}'`, home.text.includes(`As of ${asOfText}`), "");
  check("GET / shows the water-leak complaint at step 2 of 4", home.text.includes("Water leak under the kitchen sink") && home.text.includes("Step 2 of 4"), "");
  check(
    frozenToTheBrief ? "GET / shows two visitors today and the reply due today at 5 pm (the brief's date)" : "GET / shows no visitors today and the reply overdue (a later date)",
    frozenToTheBrief ? home.text.includes("2 visitors expected today") && home.text.includes("Reply due today, 5 pm") : home.text.includes("No visitors expected today") && home.text.includes("Reply overdue"),
    "",
  );
  check("GET / has no Pay control (it is not built yet)", !/\bPay\b/.test(home.text), "");
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
  check("GET /staff as staff: 200, one h1, the name and the permission in words, no links", staff.status === 200 && (staff.html.match(/<h1/g) ?? []).length === 1 && staff.text.includes("Signed in as Priya Nair") && staff.text.includes("Match bank payments") && !/<a [^>]*href/.test(staff.html.replace(/<link[^>]*>/g, "")), `status ${staff.status}`);
  const staffHome = redirectTarget(await get("/", staffCookie));
  check("GET / as staff goes to /staff", staffHome?.to === "/staff", staffHome ? `${staffHome.how} -> ${staffHome.to}` : "no redirect");
  await post("/api/auth/logout-all", undefined, staffCookie);
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
