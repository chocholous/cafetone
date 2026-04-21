// End-to-end smoke test.
//
// Drives the running server through the exact flow a real customer would:
//   1. POST /join with a fresh email      → get mock pass URL
//   2. Fetch /dev/pass/:serial.json       → get a fresh pass QR JWT
//   3. GET  /dev/login as staff           → session cookie
//   4. POST /stamp N times                → count climbs, reward_ready flips
//   5. POST /stamp once more              → 409 "reward_ready"
//   6. POST /redeem                       → count resets to 0
//
// Fails loudly with a non-zero exit code if any assertion misses.
import "dotenv/config";

const BASE = (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const STAFF_EMAIL = process.env.DEV_STAFF_EMAIL ?? "barista@cafetone.local";
const STAMPS_REQUIRED = Number(process.env.STAMPS_REQUIRED ?? 10);

let sessionCookie = "";

function extractCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = /cafetone_staff=([^;]+)/.exec(setCookie);
  return match ? `cafetone_staff=${match[1]}` : null;
}

async function req(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: any; setCookie: string | null }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  return { status: res.status, data, setCookie: res.headers.get("set-cookie") };
}

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

async function waitForServer() {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server not up at ${BASE}`);
}

async function main() {
  console.log(`→ ${BASE}`);
  await waitForServer();

  // 1. Join
  const email = `test+${Date.now()}@cafetone.local`;
  const join = await req("POST", "/join", {
    email,
    consent: true,
    platform: "apple",
  });
  assert(join.status === 200, `join returns 200 (got ${join.status})`);
  assert(join.data?.mock === true, "join response marked mock");
  const serial = String(join.data.downloadUrl).split("/").pop();
  assert(!!serial, `serial extracted: ${serial}`);

  // 2. Pull a fresh pass QR JWT from the simulator endpoint
  const passState = await req("GET", `/dev/pass/${serial}.json`);
  assert(passState.status === 200, "pass state 200");
  assert(passState.data.stamps === 0, "starts at 0 stamps");
  let token: string = passState.data.qrMessage;
  assert(typeof token === "string" && token.length > 20, "got a pass QR JWT");

  // 3. Staff login
  const login = await req("GET", `/dev/login?email=${encodeURIComponent(STAFF_EMAIL)}`);
  assert(login.status === 200, "staff login 200");
  const cookie = extractCookie(login.setCookie);
  assert(!!cookie, "session cookie issued");
  sessionCookie = cookie!;

  // 4. Stamp exactly N times
  for (let i = 1; i <= STAMPS_REQUIRED; i++) {
    const r = await req("POST", "/stamp", { token });
    assert(r.status === 200, `stamp #${i} → 200`);
    assert(r.data.stamps === i, `stamp #${i} count = ${i} (got ${r.data.stamps})`);
    if (i === STAMPS_REQUIRED) {
      assert(r.data.rewardReady === true, `stamp #${i}: rewardReady flips true`);
    }
  }

  // 5. One more stamp should be refused.
  const refresh = await req("GET", `/dev/pass/${serial}.json`);
  token = refresh.data.qrMessage;
  const extra = await req("POST", "/stamp", { token });
  assert(extra.status === 409, `stamp when full → 409 (got ${extra.status})`);
  assert(
    extra.data?.error === "reward_ready",
    `error code is "reward_ready"`,
  );

  // 6. Redeem resets
  const redeemed = await req("POST", "/redeem", { token });
  assert(redeemed.status === 200, "redeem → 200");
  assert(redeemed.data.stamps === 0, "redeem resets stamps to 0");
  assert(redeemed.data.rewardReady === false, "redeem clears rewardReady");

  console.log("\nall good.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
