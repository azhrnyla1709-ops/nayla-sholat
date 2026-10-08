/* Absensi Sholat v2 — Login NIS + jvault cloud DB */
const PRAYERS = [
  { name: "Dzuhur", icon: "☀️", time: "12:00" },
];
const TARGET_PER_DAY = 1, TARGET_PER_WEEK = 7;
const VALID_QR = ["ABSENSI-SHOLAT-VALID", "SHOLAT-BERJAMAAH-2026"];
const ADMIN_NIS = "25261122";
const BASE_URL = "https://jvault.aerialstudio.tech/";
const API_KEY = "jv_3b03bb4e22f6478e04554106f1cd99851b11d801a2831bdae68d03bb8609";
const BIN_ID = "083eb68b-21d7-4a74-b8ce-d3fe1b9e9368";
const API_READ = BASE_URL + "api?bin_id=" + BIN_ID;
const API_MERGE = BASE_URL + "api?bin_id=" + BIN_ID + "&action=merge";
const JV_HEADERS = { "X-API-Key": API_KEY, "Content-Type": "application/json" };
const LS_SESSION = "asp_session_nis";
const LS_BACKUP = "asp_cloud_backup";

const $ = (id) => document.getElementById(id);
const todayStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const nowTime = () => new Date().toTimeString().slice(0, 8);
const fmtID = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

let DB = { users: [], attendance: [] };   // cloud state
let cloudOK = false;
let currentUser = null;
let selectedPrayer = "Dzuhur";
let html5Qr = null, scanning = false;
let pinInput = "";

/* ---------- Cloud DB layer (jvault) ---------- */
function seedDB() {
  return {
    users: [{ nis: ADMIN_NIS, nama: "Admin", pin: "1234", role: "admin", createdAt: new Date().toISOString() }],
    attendance: []
  };
}
function normalize(raw) {
  // Bentuk respons JsonVault bervariasi, tangani semua yang umum:
  // {users, attendance} | {data:{users..}} | {record:{..}} | {bin:{..}} | {content:{..}} | {result:{..}}
  if (!raw || typeof raw !== "object") return null;
  if (raw.users && raw.attendance) return raw;
  for (const k of ["data", "record", "bin", "content", "result", "value"]) {
    const v = raw[k];
    if (v && typeof v === "object") {
      if (v.users && v.attendance) return v;
      // kadang data = { ...isi bin langsung } tanpa attendance (bin baru) -> tetap pakai
      if (v.users && !v.attendance) return { users: v.users, attendance: v.attendance || [] };
    }
  }
  return null;
}
async function dbLoad() {
  // 1) BACA BIN resmi JsonVault: GET api?bin_id=xxx + X-API-Key
  try {
    const r = await fetch(API_READ, { method: "GET", headers: JV_HEADERS });
    const j = await r.json();
    const n = normalize(j);
    if (n) {
      DB = { users: n.users || [], attendance: n.attendance || [] };
      if (!DB.users.some(u => String(u.nis) === ADMIN_NIS)) {
        DB.users.unshift({ nis: ADMIN_NIS, nama: "Admin", pin: "1234", role: "admin", createdAt: new Date().toISOString() });
        await dbSave(true);
      } else cloudOK = true;
      return;
    }
    // Bin kosong ({} / {data:{}} / dsb) -> seed
  } catch (e) { /* offline -> fallback bawah */ }

  // 2) fallback: backup lokal
  try {
    const b = JSON.parse(localStorage.getItem(LS_BACKUP) || "null");
    const n = normalize(b);
    if (n && n.users.length) { DB = { users: n.users, attendance: n.attendance || [] }; cloudOK = false; return; }
  } catch {}

  DB = seedDB();
  cloudOK = false;
  await dbSave(true); // best effort tulis seed ke cloud
}
async function dbSave(silent) {
  localStorage.setItem(LS_BACKUP, JSON.stringify(DB));
  // TULIS resmi JsonVault: PATCH api?bin_id=xxx&action=merge (merge parsial)
  try {
    const r = await fetch(API_MERGE, { method: "PATCH", headers: JV_HEADERS, body: JSON.stringify(DB) });
    if (r.ok) { cloudOK = true; setSync("☁️ Tersinkron ke database."); return true; }
  } catch {}
  cloudOK = false;
  if (!silent) setSync("⚠️ Offline — tersimpan lokal, akan disinkron saat online.");
  return false;
}
function setSync(msg) { const el = $("sync-status"); if (el) el.textContent = msg; }

/* ---------- Auth NIS + PIN ---------- */
function renderDots() {
  document.querySelectorAll("#pin-dots span").forEach((s, i) => s.classList.toggle("fill", i < pinInput.length));
}
function loginError(m) { $("login-error").textContent = m; }

async function doLogin() {
  const nis = $("login-nis").value.trim();
  if (!nis) return loginError("Isi NIS dulu.");
  if (pinInput.length < 4) return loginError("PIN minimal 4 digit.");
  const u = DB.users.find(x => String(x.nis) === String(nis));
  if (!u) return loginError("NIS tidak terdaftar. Hubungi admin.");
  if (String(u.pin) !== String(pinInput)) { pinInput = ""; renderDots(); return loginError("PIN salah, coba lagi."); }
  currentUser = u;
  localStorage.setItem(LS_SESSION, u.nis);
  pinInput = ""; renderDots(); loginError("");
  enterApp();
}

function enterApp() {
  $("login-screen").classList.add("hidden");
  $("app").classList.remove("hidden");
  const isAdmin = currentUser.role === "admin" || String(currentUser.nis) === ADMIN_NIS;
  $("user-chip").textContent = `🎓 ${currentUser.nis} • ${currentUser.nama}${isAdmin ? " • ADMIN" : ""}`;
  $("nav-admin").style.display = isAdmin ? "" : "none";
  $("history-filter-admin").style.display = isAdmin ? "" : "none";
  $("me-info").textContent = `${currentUser.nama} — NIS ${currentUser.nis} (${isAdmin ? "Admin" : "Siswa"})`;
  refreshAll();
}
function logout() {
  stopScan();
  currentUser = null;
  localStorage.removeItem(LS_SESSION);
  $("app").classList.add("hidden");
  $("login-screen").classList.remove("hidden");
}

document.querySelectorAll("#pin-pad button").forEach(b => {
  b.onclick = () => {
    if (b.classList.contains("pin-del")) pinInput = pinInput.slice(0, -1);
    else if (b.classList.contains("pin-ok")) { doLogin(); return; }
    else if (pinInput.length < 6 && /[0-9]/.test(b.textContent.trim())) pinInput += b.textContent.trim();
    loginError(""); renderDots();
  };
});
$("btn-login").onclick = doLogin;
$("login-nis").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
$("btn-logout").onclick = logout;
$("btn-lock").onclick = logout;

/* ---------- Attendance (per NIS) ---------- */
const myData = () => DB.attendance.filter(x => String(x.nis) === String(currentUser.nis));
const isDone = (prayer, date) => myData().some(x => x.prayer === prayer && x.date === date);

async function recordAttendance(prayer) {
  const date = todayStr();
  if (isDone(prayer, date)) { alert(prayer + " sudah diabsen hari ini (1x/hari)."); return; }
  const rec = { nis: String(currentUser.nis), nama: currentUser.nama, prayer, date, time: nowTime(), status: "Sudah Absen" };
  DB.attendance.push(rec);
  await dbSave();
  $("success-detail").textContent = `${prayer} • ${currentUser.nama} (${currentUser.nis}) • ${fmtID(date)} • ${rec.time}`;
  $("success-modal").classList.remove("hidden");
  refreshAll();
}

/* ---------- Scan QR ---------- */
function renderChips() {
  $("scan-chips").innerHTML = PRAYERS.map(p => {
    const done = currentUser && isDone(p.name, todayStr());
    return `<button class="chip ${p.name === selectedPrayer ? "sel" : ""}" data-p="${p.name}" ${done ? "disabled style='opacity:.4'" : ""}>${p.icon} ${p.name}${done ? " ✓" : ""}</button>`;
  }).join("");
  document.querySelectorAll(".chip").forEach(c => c.onclick = () => { selectedPrayer = c.dataset.p; renderChips(); });
}
async function startScan() {
  if (isDone(selectedPrayer, todayStr())) { alert(selectedPrayer + " sudah diabsen hari ini."); return; }
  if (scanning) return;
  try {
    html5Qr = new Html5Qrcode("reader");
    scanning = true;
    await html5Qr.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, (txt) => handleQr(txt), () => {});
    $("btn-start-scan").textContent = "⏳ Kamera aktif… arahkan ke QR";
  } catch (e) { alert("Kamera tidak tersedia: " + e); scanning = false; }
}
async function stopScan() {
  if (html5Qr && scanning) { try { await html5Qr.stop(); await html5Qr.clear(); } catch {} }
  scanning = false;
  const b = $("btn-start-scan"); if (b) b.textContent = "📷 Scan QR";
}
function handleQr(text) {
  text = (text || "").trim();
  if (VALID_QR.some(v => text.includes(v))) { stopScan(); recordAttendance(selectedPrayer); }
  else alert("QR tidak valid.\nIsi QR: " + text);
}
$("btn-start-scan").onclick = startScan;
$("btn-stop-scan").onclick = stopScan;
$("btn-demo-scan").onclick = () => recordAttendance(selectedPrayer);
$("btn-modal-ok").onclick = () => $("success-modal").classList.add("hidden");

(function () {
  const c = $("demo-qr");
  const img = new Image(); img.crossOrigin = "anonymous";
  img.onload = () => c.getContext("2d").drawImage(img, 0, 0, 140, 140);
  img.src = "https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=" + encodeURIComponent(VALID_QR[0]);
})();

/* ---------- Home ---------- */
function renderHome() {
  if (!currentUser) return;
  const t = todayStr();
  const data = myData().filter(x => x.date === t);
  $("today-summary").textContent = `${data.length} / 1 Sholat Dzuhur`;
  $("today-bar").style.width = (data.length / TARGET_PER_DAY * 100) + "%";
  $("today-label").textContent = fmtID(t);
  $("prayer-list").innerHTML = PRAYERS.map(p => {
    const rec = data.find(x => x.prayer === p.name);
    return `<div class="prayer-card ${rec ? "is-done" : ""}">
      <div class="prayer-icon">${p.icon}</div>
      <div><b>${p.name}</b><br><small>⏰ ${p.time} • ${rec ? "Absen " + rec.time : "Belum absen"}</small></div>
      <span class="status ${rec ? "done" : "todo"}">${rec ? "🟢 Sudah Absen" : "⚪ Belum Absen"}</span>
    </div>`;
  }).join("");
}

/* ---------- History ---------- */
function renderHistory() {
  if (!currentUser) return;
  const isAdmin = $("history-filter-admin").style.display !== "none";
  const nisF = ($("history-nis") && $("history-nis").value.trim()) || "";
  const dateF = $("history-date").value;
  let data = [...DB.attendance].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  if (isAdmin) { if (nisF) data = data.filter(x => String(x.nis).includes(nisF)); }
  else data = data.filter(x => String(x.nis) === String(currentUser.nis));
  if (dateF) data = data.filter(x => x.date === dateF);
  $("history-list").innerHTML = data.length ? data.slice(0, 200).map(x => {
    const p = PRAYERS.find(p => p.name === x.prayer);
    return `<div class="hist-item"><div class="t">${p ? p.icon : "🕌"}</div>
      <div><b>${x.prayer}</b> <small>• ${x.nama || ""} (${x.nis})</small><br><small>📅 ${x.date} • ⏰ ${x.time}</small></div>
      <span class="badge">✓ ${x.status}</span></div>`;
  }).join("") : `<div class="card muted">Belum ada data. Yuk scan dulu! 🕌</div>`;
}
$("history-date").onchange = renderHistory;
if ($("history-nis")) $("history-nis").oninput = renderHistory;
$("btn-today").onclick = () => { $("history-date").value = todayStr(); renderHistory(); };
$("btn-all").onclick = () => { $("history-date").value = ""; if ($("history-nis")) $("history-nis").value = ""; renderHistory(); };

/* ---------- Stats (akun saya) ---------- */
function last7() { const o = []; for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); o.push(todayStr(d)); } return o; }
function renderStats() {
  if (!currentUser) return;
  const data = myData();
  $("stat-total").textContent = data.length;
  const days = new Set(data.map(x => x.date)).size || 1;
  $("stat-percent").textContent = Math.min(100, Math.round(data.length / (days * TARGET_PER_DAY) * 100)) + "%";
  const td = data.filter(x => x.date === todayStr()).length;
  $("stat-today").textContent = `${td}/1`;
  const now = new Date(), day = (now.getDay() + 6) % 7, mon = new Date(now);
  mon.setDate(now.getDate() - day);
  let w = 0;
  for (let i = 0; i < 7; i++) { const d = new Date(mon); d.setDate(mon.getDate() + i); w += data.filter(x => x.date === todayStr(d)).length; }
  $("stat-week").textContent = `${w}/${TARGET_PER_WEEK}`;
  $("stat-week-pct").textContent = `(${Math.round(w / TARGET_PER_WEEK * 100)}%)`;
  $("week-bar").style.width = (w / TARGET_PER_WEEK * 100) + "%";
  $("chart-bars").innerHTML = last7().map(d => {
    const n = data.filter(x => x.date === d).length;
    return `<div class="bar ${n >= 1 ? "gold" : ""}"><div style="height:${n >= 1 ? 90 : 6}px"></div><small>${d.slice(8)}<br>${n}/1</small></div>`;
  }).join("");
  const since = new Date(); since.setDate(since.getDate() - 30);
  $("per-prayer").innerHTML = PRAYERS.map(p => {
    const n = data.filter(x => x.prayer === p.name && x.date >= todayStr(since)).length;
    return `<div style="margin:8px 0"><small>${p.icon} ${p.name} — <b>${n}</b>x</small>
      <div class="progress"><div style="width:${Math.min(100, n / 30 * 100)}%"></div></div></div>`;
  }).join("");
}

/* ---------- Admin: kelola NIS ---------- */
function renderUsers() {
  $("user-count").textContent = DB.users.length;
  $("user-list").innerHTML = DB.users.map(u => `
    <div class="hist-item"><div class="t">${u.role === "admin" ? "👑" : "🎓"}</div>
      <div><b>${u.nama}</b> <small>(${u.role})</small><br><small>NIS: ${u.nis} • PIN: ${u.pin}</small></div>
      ${String(u.nis) === ADMIN_NIS ? "" : `<button class="btn-mini-danger" data-del="${u.nis}">Hapus</button>`}
    </div>`).join("");
  document.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    if (!confirm("Hapus NIS " + b.dataset.del + " beserta riwayatnya?")) return;
    DB.users = DB.users.filter(u => String(u.nis) !== String(b.dataset.del));
    DB.attendance = DB.attendance.filter(a => String(a.nis) !== String(b.dataset.del));
    await dbSave(); renderUsers(); refreshAll();
  });
}
$("btn-add-user").onclick = async () => {
  const nis = $("new-nis").value.trim(), nama = $("new-nama").value.trim();
  let pin = $("new-user-pin").value.trim() || "1234";
  if (!nis) { $("admin-msg").textContent = "NIS wajib diisi."; return; }
  if (!nama) { $("admin-msg").textContent = "Nama wajib diisi."; return; }
  if (!/^\d{4,6}$/.test(pin)) { $("admin-msg").textContent = "PIN harus 4–6 digit angka."; return; }
  if (DB.users.some(u => String(u.nis) === String(nis))) { $("admin-msg").textContent = "NIS sudah terdaftar."; return; }
  DB.users.push({ nis: String(nis), nama, pin, role: String(nis) === ADMIN_NIS ? "admin" : "siswa", createdAt: new Date().toISOString() });
  await dbSave();
  $("admin-msg").textContent = `✅ NIS ${nis} (${nama}) ditambahkan.`;
  $("new-nis").value = $("new-nama").value = $("new-user-pin").value = "";
  renderUsers();
};

/* ---------- Settings ---------- */
$("btn-change-pin").onclick = async () => {
  const a = $("new-pin").value.trim(), b = $("confirm-pin").value.trim();
  if (!/^\d{4,6}$/.test(a)) { $("pin-msg").textContent = "PIN harus 4–6 digit angka."; return; }
  if (a !== b) { $("pin-msg").textContent = "Konfirmasi PIN tidak sama."; return; }
  currentUser.pin = a;
  const i = DB.users.findIndex(u => String(u.nis) === String(currentUser.nis));
  if (i >= 0) DB.users[i].pin = a;
  await dbSave();
  $("pin-msg").textContent = "✅ PIN berhasil diganti & tersimpan di database.";
  $("new-pin").value = $("confirm-pin").value = "";
};
$("btn-reset").onclick = async () => {
  if (!confirm("Hapus seluruh riwayat akun " + currentUser.nis + "?")) return;
  DB.attendance = DB.attendance.filter(a => String(a.nis) !== String(currentUser.nis));
  await dbSave(); refreshAll(); alert("Riwayat saya dihapus.");
};

/* ---------- Nav ---------- */
document.querySelectorAll(".bottom-nav button").forEach(b => b.onclick = () => {
  document.querySelectorAll(".bottom-nav button").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  $(b.dataset.page).classList.add("active");
  if (b.dataset.page !== "page-scan") stopScan();
  if (b.dataset.page === "page-admin") renderUsers();
  if (b.dataset.page === "page-stats") renderStats();
  if (b.dataset.page === "page-history") renderHistory();
  if (b.dataset.page === "page-home") renderHome();
});

function refreshAll() { renderHome(); renderChips(); renderHistory(); renderStats(); if ($("page-admin").classList.contains("active")) renderUsers(); }

/* ---------- Clock + Boot ---------- */
setInterval(() => {
  const n = new Date();
  $("datetime").textContent = n.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + " • " + n.toLocaleTimeString("id-ID");
}, 1000);

(async function boot() {
  renderDots();
  $("db-status").textContent = "Menghubungkan database…";
  await dbLoad();
  $("db-status").textContent = cloudOK ? "☁️ Database online." : "⚠️ Database offline — mode lokal (data tetap tersimpan).";
  setSync(cloudOK ? "☁️ Database online." : "⚠️ Mode lokal.");
  // auto-login jika ada sesi
  const s = localStorage.getItem(LS_SESSION);
  if (s) {
    const u = DB.users.find(x => String(x.nis) === String(s));
    if (u) { currentUser = u; enterApp(); return; }
  }
})();
