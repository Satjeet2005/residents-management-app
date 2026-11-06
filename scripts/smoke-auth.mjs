// Smoke test for login over real HTTP. No dependencies: Node 24's fetch.
//
//   node scripts/smoke-auth.mjs <BASE_URL> <demo-phone>
//   npm run smoke:auth -- http://localhost:3000 5000000006
//
// BASE_URL and the phone may also come from the BASE_URL and SMOKE_PHONE environment variables.
// The cookie checks depend on the scheme of BASE_URL: https expects __Host-session with Secure; http expects session without Secure.
// The server must be in demo mode (DEMO_MODE=true), because the check signs in with the code the API returns for a
// demo phone. The script never prints the code, the session token or the cookie value, only their lengths.

const baseUrl = (process.argv[2] ?? process.env.BASE_URL ?? "").replace(/\/+$/, "");
const phone = process.argv[3] ?? process.env.SMOKE_PHONE ?? "";

if (!/^https?:\/\//.test(baseUrl) || !/^[0-9]{10}$/.test(phone)) {
  console.error("Usage: node scripts/smoke-auth.mjs <BASE_URL> <10-digit demo phone>");
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  return Boolean(ok);
};

async function call(method, path, { body, cookie, origin } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const text = await response.text();
  let json = null;
  try {
    json = text === "" ? null : JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, headers: response.headers };
}

const keys = (value) => (value && typeof value === "object" ? Object.keys(value).sort().join(",") : "");
const unknownPhone = () => `59${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

async function run() {
  const health = await call("GET", "/api/health");
  check("health answers 200 and is no-store", health.status === 200 && health.json?.status === "ok" && health.headers.get("cache-control") === "no-store", `status ${health.status}`);

  // 1. Ask for a code.
  const first = await call("POST", "/api/auth/otp/request", { body: { phone } });
  const code = first.json?.demoCode;
  check("request code: 200, generic message, a 6-digit demo code", first.status === 200 && first.json?.message === "OTP_SENT_GENERIC" && /^[0-9]{6}$/.test(code ?? ""), `status ${first.status}, demoCode length ${(code ?? "").length}`);
  if (!/^[0-9]{6}$/.test(code ?? "")) {
    check("server is in demo mode (needed to sign in)", false, "no demoCode in the response: start the server with DEMO_MODE=true and use a demo phone");
    return;
  }

  // 2. A second request within 30 seconds is refused.
  const second = await call("POST", "/api/auth/otp/request", { body: { phone } });
  check("second request within 30 s: 429, Retry-After, generic key", second.status === 429 && second.json?.error === "TOO_MANY_REQUESTS" && Number(second.headers.get("retry-after")) >= 1, `status ${second.status}, Retry-After ${second.headers.get("retry-after")}`);

  // 3. An unknown phone looks the same as a known one.
  const stranger = await call("POST", "/api/auth/otp/request", { body: { phone: unknownPhone() } });
  check(
    "unknown phone: same status and body shape as a known phone",
    stranger.status === first.status && keys(stranger.json) === keys(first.json) && stranger.json?.message === first.json?.message && stranger.json?.retryAfterSeconds === first.json?.retryAfterSeconds,
    `known ${first.status} {${keys(first.json)}}, unknown ${stranger.status} {${keys(stranger.json)}}`,
  );

  // 4. A wrong code is refused with the generic key.
  const wrongCode = code === "000000" ? "111111" : "000000";
  const wrong = await call("POST", "/api/auth/otp/verify", { body: { phone, code: wrongCode } });
  check("wrong code: 400 OTP_NOT_ACCEPTED (the generic key)", wrong.status === 400 && wrong.json?.error === "OTP_NOT_ACCEPTED" && !wrong.headers.get("set-cookie"), `status ${wrong.status}, key ${wrong.json?.error}`);

  // 5. The right code signs in, and the cookie has the right attributes.
  const verified = await call("POST", "/api/auth/otp/verify", { body: { phone, code } });
  const setCookie = verified.headers.getSetCookie?.()[0] ?? "";
  const [pair, ...attributes] = setCookie.split(";").map((part) => part.trim());
  const cookieName = pair.split("=")[0];
  const cookieValue = pair.slice(cookieName.length + 1);
  const flags = attributes.map((a) => a.toLowerCase());
  // The cookie follows the scheme of BASE_URL (D94): https gets __Host-session and Secure, http gets session without Secure.
  const https = baseUrl.startsWith("https://");
  const expectedName = https ? "__Host-session" : "session";
  check("verify: 200 with a role and a redirect", verified.status === 200 && ["RESIDENT", "STAFF"].includes(verified.json?.role) && typeof verified.json?.redirectTo === "string", `status ${verified.status}, role ${verified.json?.role}, redirectTo ${verified.json?.redirectTo}`);
  check("cookie: HttpOnly and SameSite=Lax, Path=/, no Domain", flags.includes("httponly") && flags.includes("samesite=lax") && flags.includes("path=/") && !flags.some((f) => f.startsWith("domain=")), `name ${cookieName}, value length ${cookieValue.length}, attributes ${flags.join(" ")}`);
  check(
    https ? "cookie over https: __Host-session and Secure" : "cookie over http: session, and not Secure",
    cookieName === expectedName && flags.includes("secure") === https,
    `expected ${expectedName}${https ? " with Secure" : " without Secure"}, got ${cookieName}${flags.includes("secure") ? " with Secure" : " without Secure"}`,
  );
  const cookie = `${cookieName}=${cookieValue}`;

  // 6. /api/me with and without the cookie.
  const anonymous = await call("GET", "/api/me");
  check("/api/me without a cookie: 401 UNAUTHENTICATED, no-store", anonymous.status === 401 && anonymous.json?.error === "UNAUTHENTICATED" && anonymous.headers.get("cache-control") === "no-store", `status ${anonymous.status}`);
  const me = await call("GET", "/api/me", { cookie });
  const isStaff = verified.json?.role === "STAFF";
  check(
    "/api/me with the cookie: 200 with id, name, role, flats, and permissions only for staff",
    me.status === 200 && typeof me.json?.id === "string" && me.json?.role === verified.json?.role && Array.isArray(me.json?.flats) && Array.isArray(me.json?.permissions) && (isStaff ? me.json.permissions.length > 0 : me.json.permissions.length === 0) && !JSON.stringify(me.json).includes(phone),
    `status ${me.status}, role ${me.json?.role}, flats ${me.json?.flats?.length}, permissions ${me.json?.permissions?.length}`,
  );

  // 7. A request from another site is refused, and does not end the session.
  const forged = await call("POST", "/api/auth/logout-all", { cookie, origin: "https://evil.example" });
  const stillIn = await call("GET", "/api/me", { cookie });
  check("logout-all from another origin: 403 CSRF_BLOCKED, session untouched", forged.status === 403 && forged.json?.error === "CSRF_BLOCKED" && stillIn.status === 200, `status ${forged.status}, /api/me after ${stillIn.status}`);

  // 8. Log out everywhere; the cookie stops working at once.
  const out = await call("POST", "/api/auth/logout-all", { cookie });
  const cleared = out.headers.getSetCookie?.() ?? [];
  check(
    "logout-all with the cookie: 204 and both cookie names cleared",
    out.status === 204 && cleared.length === 2 && cleared.every((line) => /max-age=0/i.test(line)) && cleared.map((line) => line.split("=")[0]).sort().join(",") === "__Host-session,session",
    `status ${out.status}, ${cleared.length} Set-Cookie lines`,
  );
  const after = await call("GET", "/api/me", { cookie });
  check("/api/me after logout-all: 401", after.status === 401 && after.json?.error === "UNAUTHENTICATED", `status ${after.status}`);
}

try {
  await run();
} catch (error) {
  check("the server could be reached", false, error instanceof Error ? error.message.slice(0, 120) : "network error");
}

const width = Math.max(...results.map((r) => r.name.length));
console.log(`smoke:auth against ${baseUrl} as ${phone.slice(0, 2)}********`);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? `\nALL ${results.length} CHECKS PASSED` : `\n${failed} OF ${results.length} CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);
