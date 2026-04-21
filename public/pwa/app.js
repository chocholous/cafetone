// Barista PWA logic.
// Three screens toggled by auth state:
//   1. not signed in  → email form
//   2. signed in      → camera scanner
//   3. after scan     → sliding result sheet with stamp / redeem
//
// Camera stays running through scans; after a scan we pause detection,
// show the result, and resume on dismiss. This avoids the double-scan
// problem (same QR read twice within a second).

const $ = (sel) => document.querySelector(sel);

const loginView = $("#login");
const loginForm = $("#login-form");
const loginBtn  = $("#login-btn");
const loginSent = $("#login-sent");
const scannerView = $("#scanner");
const logoutBtn = $("#logout");
const resultEl  = $("#result");
const toastEl   = $("#toast");

let scanner = null;
let scanLock = false;     // true while a result is visible; ignore reads
let lastToken = "";       // de-dupe identical tokens within a short window
let lastTokenAt = 0;

function toast(msg, ms = 1800) {
  toastEl.textContent = msg;
  toastEl.classList.add("shown");
  setTimeout(() => toastEl.classList.remove("shown"), ms);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(body?.error || `http_${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

// ─── Auth ────────────────────────────────────────────────────────────────
async function checkAuth() {
  try {
    await api("/staff/me");
    return true;
  } catch {
    return false;
  }
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginBtn.disabled = true;
  loginBtn.textContent = "Sending…";
  try {
    await api("/staff/login", {
      method: "POST",
      body: JSON.stringify({ email: $("#login-email").value.trim() }),
    });
    loginSent.hidden = false;
    loginForm.hidden = true;
  } catch {
    toast("Something went wrong");
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Send magic link";
  }
});

logoutBtn.addEventListener("click", async () => {
  await api("/staff/logout", { method: "POST" }).catch(() => {});
  location.reload();
});

// ─── Scanner ─────────────────────────────────────────────────────────────
async function startScanner() {
  scanner = new Html5Qrcode("reader", { verbose: false });
  const config = { fps: 10, qrbox: { width: 240, height: 240 } };
  try {
    await scanner.start({ facingMode: "environment" }, config, onScan, () => {});
  } catch (err) {
    console.error(err);
    toast("Camera permission denied");
  }
}

async function onScan(decoded) {
  if (scanLock) return;
  const now = Date.now();
  if (decoded === lastToken && now - lastTokenAt < 3000) return;
  lastToken = decoded;
  lastTokenAt = now;

  scanLock = true;
  showPending();
  // First try a stamp. If the server says reward_ready, do a redeem instead.
  try {
    const r = await api("/stamp", {
      method: "POST",
      body: JSON.stringify({ token: decoded }),
    });
    showStampResult(r);
  } catch (err) {
    if (err.status === 409 && err.body?.error === "reward_ready") {
      // Ask the barista to confirm the redemption explicitly — avoids
      // accidentally blowing the reward on a test scan.
      showRedeemConfirm(decoded, err.body);
    } else if (err.status === 429) {
      showError("Wait a bit", "Customer was just stamped. Try again in a moment.");
    } else if (err.status === 400 && err.body?.error === "invalid_token") {
      showError("Expired QR", "Ask the customer to open the pass again.");
    } else if (err.status === 404) {
      showError("Unknown customer", "This pass is not in our system.");
    } else {
      showError("Error", err.body?.error || "Something went wrong.");
    }
  }
}

function showPending() {
  resultEl.innerHTML = `<h2>Scanning…</h2>`;
  resultEl.classList.add("shown");
}

function showStampResult(r) {
  const { stamps, stampsRequired, rewardReady } = r;
  resultEl.innerHTML = `
    <h2 class="ok-glow">Stamped</h2>
    <p>${rewardReady ? "Reward unlocked!" : "Keep 'em coming."}</p>
    <div class="big">${stamps} / ${stampsRequired}</div>
    <div class="actions">
      <button class="btn-primary" id="done">Done</button>
    </div>`;
  resultEl.classList.add("shown");
  $("#done").addEventListener("click", dismissResult);
}

function showRedeemConfirm(token, body) {
  resultEl.innerHTML = `
    <h2 class="ok-glow">Reward ready</h2>
    <p>Confirm to redeem and reset the card.</p>
    <div class="actions">
      <button class="btn-secondary" id="cancel">Cancel</button>
      <button class="btn-primary" id="confirm">Redeem</button>
    </div>`;
  resultEl.classList.add("shown");
  $("#cancel").addEventListener("click", dismissResult);
  $("#confirm").addEventListener("click", async () => {
    try {
      const r = await api("/redeem", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      resultEl.innerHTML = `
        <h2 class="ok-glow">Redeemed</h2>
        <p>Card reset.</p>
        <div class="big">0 / ${r.stampsRequired}</div>
        <div class="actions">
          <button class="btn-primary" id="done">Done</button>
        </div>`;
      $("#done").addEventListener("click", dismissResult);
    } catch (err) {
      showError("Error", err.body?.error || "Could not redeem.");
    }
  });
}

function showError(title, msg) {
  resultEl.innerHTML = `
    <h2 class="err-glow">${title}</h2>
    <p>${msg}</p>
    <div class="actions">
      <button class="btn-primary" id="done">OK</button>
    </div>`;
  resultEl.classList.add("shown");
  $("#done").addEventListener("click", dismissResult);
}

function dismissResult() {
  resultEl.classList.remove("shown");
  setTimeout(() => { resultEl.innerHTML = ""; scanLock = false; }, 200);
}

// ─── Boot ────────────────────────────────────────────────────────────────
(async () => {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/pwa/sw.js").catch(() => {});
  }
  const authed = await checkAuth();
  if (authed) {
    scannerView.hidden = false;
    logoutBtn.hidden = false;
    await startScanner();
  } else {
    loginView.hidden = false;
  }
})();
