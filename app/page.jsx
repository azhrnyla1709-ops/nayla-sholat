"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./globals.css";

const PRAYERS = [{ name: "Dzuhur", icon: "fa-solid fa-sun", time: "12:00" }];
const TARGET_PER_DAY = 1;
const TARGET_PER_WEEK = 7;
const VALID_QR = ["ABSENSI-SHOLAT-VALID", "SHOLAT-BERJAMAAH-2026"];
const ADMIN_NIS = "25261122";
const BASE_URL = "https://jvault.aerialstudio.tech/";
const API_KEY = "jv_3b03bb4e22f6478e04554106f1cd99851b11d801a2831bdae68d03bb8609";
const BIN_ID = "083eb68b-21d7-4a74-b8ce-d3fe1b9e9368";
const API_READ = `${BASE_URL}api?bin_id=${BIN_ID}`;
const API_MERGE = `${BASE_URL}api?bin_id=${BIN_ID}&action=merge`;
const JV_HEADERS = { "X-API-Key": API_KEY, "Content-Type": "application/json" };
const LS_SESSION = "asp_session_nis";
const LS_BACKUP = "asp_cloud_backup";

const todayStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const nowTime = () => new Date().toTimeString().slice(0, 8);
const fmtID = (iso) =>
  new Date(iso + "T00:00:00").toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
const seedDB = () => ({
  users: [{ nis: ADMIN_NIS, nama: "Admin", pin: "1234", role: "admin", createdAt: new Date().toISOString() }],
  attendance: [],
});

function normalize(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (Array.isArray(raw.users))
    return { users: raw.users, attendance: Array.isArray(raw.attendance) ? raw.attendance : [] };
  const seen = new Set();
  const queue = [raw];
  while (queue.length) {
    const o = queue.shift();
    if (!o || typeof o !== "object" || seen.has(o)) continue;
    seen.add(o);
    if (Array.isArray(o.users))
      return { users: o.users, attendance: Array.isArray(o.attendance) ? o.attendance : [] };
    for (const k of ["data", "record", "bin", "content", "result", "value", "payload", "body"]) {
      if (o[k] && typeof o[k] === "object") queue.push(o[k]);
    }
  }
  return null;
}

function mergeDB(cloud, local) {
  const c = cloud || { users: [], attendance: [] };
  const l = local || { users: [], attendance: [] };
  const users = new Map();
  [...l.users, ...c.users].forEach((u) => {
    if (u && u.nis != null) users.set(String(u.nis), u);
  });
  const att = new Map();
  [...(c.attendance || []), ...(l.attendance || [])].forEach((a) => {
    if (a && a.nis != null && a.date && a.prayer) att.set(`${a.nis}|${a.date}|${a.prayer}`, a);
  });
  return { users: [...users.values()], attendance: [...att.values()] };
}

function readBackup() {
  try {
    const b = JSON.parse(localStorage.getItem(LS_BACKUP) || "null");
    const n = normalize(b);
    if (n && (n.users.length || (n.attendance && n.attendance.length)))
      return { users: n.users || [], attendance: n.attendance || [] };
  } catch {}
  return null;
}

export default function Home() {
  const [db, setDb] = useState({ users: [], attendance: [] });
  const [cloudOK, setCloudOK] = useState(false);
  const [syncMsg, setSyncMsg] = useState("—");
  const [dbStatus, setDbStatus] = useState("Menghubungkan database…");
  const [currentUser, setCurrentUser] = useState(null);
  const [loginNis, setLoginNis] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [loginError, setLoginError] = useState("");
  const [page, setPage] = useState("home");
  const [now, setNow] = useState(new Date());
  const [historyDate, setHistoryDate] = useState("");
  const [historyNis, setHistoryNis] = useState("");
  const [success, setSuccess] = useState(null);
  const [newNis, setNewNis] = useState("");
  const [newNama, setNewNama] = useState("");
  const [newUserPin, setNewUserPin] = useState("");
  const [adminMsg, setAdminMsg] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinMsg, setPinMsg] = useState("");
  const [scanning, setScanning] = useState(false);

  const dbRef = useRef(db);
  dbRef.current = db;
  const userRef = useRef(currentUser);
  userRef.current = currentUser;
  const qrRef = useRef(null);
  const lastScanRef = useRef(0);

  const isAdmin = useMemo(
    () => !!currentUser && (currentUser.role === "admin" || String(currentUser.nis) === ADMIN_NIS),
    [currentUser]
  );
  const myData = useMemo(
    () => (currentUser ? db.attendance.filter((x) => String(x.nis) === String(currentUser.nis)) : []),
    [db, currentUser]
  );
  const isDone = useCallback(
    (prayer, date) => myData.some((x) => x.prayer === prayer && x.date === date),
    [myData]
  );

  const backupLocal = useCallback((state) => {
    try {
      localStorage.setItem(LS_BACKUP, JSON.stringify(state));
    } catch {}
  }, []);

  const dbLoad = useCallback(async () => {
    let cloud = null;
    let cloudFetched = false;
    let loadNote = "";
    try {
      const r = await fetch(API_READ, { method: "GET", headers: JV_HEADERS });
      const txt = await r.text();
      if (r.ok) {
        try {
          const n = normalize(JSON.parse(txt));
          if (n) {
            cloud = { users: n.users || [], attendance: n.attendance || [] };
            cloudFetched = true;
          } else loadNote = "Respons cloud tidak berisi users.";
        } catch {
          loadNote = "Respons cloud bukan JSON.";
        }
      } else {
        loadNote = `Baca cloud gagal (HTTP ${r.status}).`;
      }
      if (!r.ok || !cloudFetched) console.warn("[dbLoad]", r.status, txt.slice(0, 300));
    } catch (e) {
      loadNote = `Tidak bisa hubungi cloud (${e.message || e}).`;
    }

    const local = readBackup();
    let merged = mergeDB(cloud, local);
    if (!merged.users.length) merged = seedDB();
    if (!merged.users.some((u) => String(u.nis) === ADMIN_NIS)) {
      merged.users.unshift({
        nis: ADMIN_NIS,
        nama: "Admin",
        pin: "1234",
        role: "admin",
        createdAt: new Date().toISOString(),
      });
    }
    backupLocal(merged);
    setDb(merged);

    if (cloudFetched) {
      const cloudKeys = new Set((cloud ? cloud.attendance : []).map((a) => `${a.nis}|${a.date}|${a.prayer}`));
      const hasPending =
        merged.attendance.some((a) => !cloudKeys.has(`${a.nis}|${a.date}|${a.prayer}`)) || !cloud;
      setCloudOK(true);
      setSyncMsg("Database online.");
      if (hasPending) await dbSaveRef.current(true);
      return merged;
    }
    setCloudOK(false);
    const st = loadNote || "Mode lokal.";
    setSyncMsg(`${st} Data tetap tersimpan lokal.`);
    setDbStatus(st);
    return merged;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backupLocal]);

  const dbSave = useCallback(
    async (silent, stateOverride) => {
      const state = stateOverride || dbRef.current;
      backupLocal(state);
      const payload = JSON.stringify(state);
      const tries = [
        { method: "PATCH", url: API_MERGE, label: "merge" },
        { method: "PATCH", url: API_READ, label: "replace" },
        { method: "PUT", url: API_READ, label: "put" },
        { method: "POST", url: API_READ, label: "post" },
      ];
      let lastErr = "";
      for (const t of tries) {
        try {
          const r = await fetch(t.url, { method: t.method, headers: JV_HEADERS, body: payload });
          const txt = await r.text().catch(() => "");
          if (r.ok) {
            try {
              const vr = await fetch(API_READ, { method: "GET", headers: JV_HEADERS });
              const vj = normalize(JSON.parse(await vr.text()));
              const keys = new Set((vj ? vj.attendance : []).map((a) => `${a.nis}|${a.date}|${a.prayer}`));
              const missing = state.attendance.filter((a) => !keys.has(`${a.nis}|${a.date}|${a.prayer}`));
              if (missing.length === 0) {
                setCloudOK(true);
                setSyncMsg("Tersinkron ke database.");
                return true;
              }
              lastErr = `server OK tapi verifikasi kurang ${missing.length} data (${t.label}).`;
              console.warn("[dbSave] verify fail via", t.label, missing);
              continue;
            } catch {
              setCloudOK(true);
              setSyncMsg("Tersinkron ke database.");
              return true;
            }
          }
          lastErr = `server ${r.status} (${t.label}): ${String(txt).slice(0, 200)}`;
          console.warn("[dbSave]", lastErr);
        } catch (e) {
          lastErr = `jaringan (${t.label}): ${e.message || e}`;
        }
      }
      setCloudOK(false);
      setSyncMsg(`Belum tersinkron — data AMAN di HP. ${lastErr} Tekan 'Sinkron Ulang'.`);
      if (!silent) alert(`Absensi tersimpan di HP, tapi gagal ke database.\n\n${lastErr}`);
      return false;
    },
    [backupLocal]
  );
  const dbSaveRef = useRef(dbSave);
  dbSaveRef.current = dbSave;

  // Boot: clock + load cloud + auto-login
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    (async () => {
      const merged = await dbLoad();
      setDbStatus(cloudOK ? "Database online." : "Database offline — mode lokal (data tetap tersimpan).");
      const s = localStorage.getItem(LS_SESSION);
      if (s) {
        const u = merged.users.find((x) => String(x.nis) === String(s));
        if (u) setCurrentUser(u);
      }
    })();
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doLogin = useCallback(() => {
    const nis = loginNis.trim();
    if (!nis) return setLoginError("Isi NIS dulu.");
    if (pinInput.length < 4) return setLoginError("PIN minimal 4 digit.");
    const u = dbRef.current.users.find((x) => String(x.nis) === String(nis));
    if (!u) return setLoginError("NIS tidak terdaftar. Hubungi admin.");
    if (String(u.pin) !== String(pinInput)) {
      setPinInput("");
      return setLoginError("PIN salah, coba lagi.");
    }
    setCurrentUser(u);
    localStorage.setItem(LS_SESSION, u.nis);
    setPinInput("");
    setLoginError("");
    setPage("home");
  }, [loginNis, pinInput]);

  const logout = useCallback(async () => {
    await stopScan();
    setCurrentUser(null);
    localStorage.removeItem(LS_SESSION);
    setPage("home");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recordAttendance = useCallback(
    async (prayer) => {
      const user = userRef.current;
      if (!user) return;
      const date = todayStr();
      const state = dbRef.current;
      if (state.attendance.some((x) => String(x.nis) === String(user.nis) && x.prayer === prayer && x.date === date)) {
        alert(`${prayer} sudah diabsen hari ini (1x/hari).`);
        return;
      }
      const rec = {
        nis: String(user.nis),
        nama: user.nama,
        prayer,
        date,
        time: nowTime(),
        status: "Sudah Absen",
      };
      const next = { ...state, attendance: [...state.attendance, rec] };
      setDb(next);
      setSuccess({ ...rec, dateLabel: fmtID(date) });
      const ok = await dbSave(false, next);
      if (!ok) setSuccess((s) => (s ? { ...s, pending: true } : s));
    },
    [dbSave]
  );

  const stopScan = useCallback(async () => {
    if (qrRef.current) {
      try {
        await qrRef.current.stop();
        await qrRef.current.clear();
      } catch {}
      qrRef.current = null;
    }
    setScanning(false);
  }, []);

  const handleQr = useCallback(
    (text) => {
      const t = Date.now();
      if (t - lastScanRef.current < 3000) return;
      lastScanRef.current = t;
      text = (text || "").trim();
      if (VALID_QR.some((v) => text.includes(v))) {
        stopScan();
        recordAttendance("Dzuhur");
      } else alert(`QR tidak valid.\nIsi QR: ${text}`);
    },
    [recordAttendance, stopScan]
  );

  const startScan = useCallback(async () => {
    if (isDone("Dzuhur", todayStr())) {
      alert("Dzuhur sudah diabsen hari ini.");
      return;
    }
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const qr = new Html5Qrcode("reader");
      qrRef.current = qr;
      setScanning(true);
      await qr.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, handleQr, () => {});
    } catch (e) {
      alert(`Kamera tidak tersedia: ${e}`);
      setScanning(false);
    }
  }, [handleQr, isDone]);

  const goPage = useCallback(
    (p) => {
      setPage(p);
      if (p !== "scan") stopScan();
    },
    [stopScan]
  );

  const addUser = useCallback(async () => {
    const nis = newNis.trim();
    const nama = newNama.trim();
    const pin = newUserPin.trim() || "1234";
    if (!nis) return setAdminMsg("NIS wajib diisi.");
    if (!nama) return setAdminMsg("Nama wajib diisi.");
    if (!/^\d{4,6}$/.test(pin)) return setAdminMsg("PIN harus 4–6 digit angka.");
    if (dbRef.current.users.some((u) => String(u.nis) === String(nis))) return setAdminMsg("NIS sudah terdaftar.");
    const next = {
      ...dbRef.current,
      users: [
        ...dbRef.current.users,
        {
          nis: String(nis),
          nama,
          pin,
          role: String(nis) === ADMIN_NIS ? "admin" : "siswa",
          createdAt: new Date().toISOString(),
        },
      ],
    };
    setDb(next);
    await dbSave(false, next);
    setAdminMsg(`Berhasil: NIS ${nis} (${nama}) ditambahkan.`);
    setNewNis("");
    setNewNama("");
    setNewUserPin("");
  }, [newNis, newNama, newUserPin, dbSave]);

  const delUser = useCallback(
    async (nis) => {
      if (!confirm(`Hapus NIS ${nis} beserta riwayatnya?`)) return;
      const next = {
        users: dbRef.current.users.filter((u) => String(u.nis) !== String(nis)),
        attendance: dbRef.current.attendance.filter((a) => String(a.nis) !== String(nis)),
      };
      setDb(next);
      await dbSave(false, next);
    },
    [dbSave]
  );

  const changePin = useCallback(async () => {
    const a = newPin.trim();
    const b = confirmPin.trim();
    if (!/^\d{4,6}$/.test(a)) return setPinMsg("PIN harus 4–6 digit angka.");
    if (a !== b) return setPinMsg("Konfirmasi PIN tidak sama.");
    const user = userRef.current;
    const next = {
      ...dbRef.current,
      users: dbRef.current.users.map((u) => (String(u.nis) === String(user.nis) ? { ...u, pin: a } : u)),
    };
    setDb(next);
    setCurrentUser({ ...user, pin: a });
    await dbSave(false, next);
    setPinMsg("Berhasil: PIN diganti & tersimpan di database.");
    setNewPin("");
    setConfirmPin("");
  }, [newPin, confirmPin, dbSave]);

  const resetMine = useCallback(async () => {
    const user = userRef.current;
    if (!confirm(`Hapus seluruh riwayat akun ${user.nis}?`)) return;
    const next = {
      ...dbRef.current,
      attendance: dbRef.current.attendance.filter((a) => String(a.nis) !== String(user.nis)),
    };
    setDb(next);
    await dbSave(false, next);
    alert("Riwayat saya dihapus.");
  }, [dbSave]);

  // ---- derived: home / history / stats ----
  const today = todayStr();
  const todayData = myData.filter((x) => x.date === today);
  const historyData = useMemo(() => {
    let data = [...db.attendance].sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
    if (isAdmin) {
      if (historyNis.trim()) data = data.filter((x) => String(x.nis).includes(historyNis.trim()));
    } else if (currentUser) {
      data = data.filter((x) => String(x.nis) === String(currentUser.nis));
    }
    if (historyDate) data = data.filter((x) => x.date === historyDate);
    return data.slice(0, 200);
  }, [db, isAdmin, historyNis, historyDate, currentUser]);

  const stats = useMemo(() => {
    const data = myData;
    const days = new Set(data.map((x) => x.date)).size || 1;
    const pct = Math.min(100, Math.round((data.length / (days * TARGET_PER_DAY)) * 100));
    const td = data.filter((x) => x.date === todayStr()).length;
    const n = new Date();
    const day = (n.getDay() + 6) % 7;
    const mon = new Date(n);
    mon.setDate(n.getDate() - day);
    let w = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      w += data.filter((x) => x.date === todayStr(d)).length;
    }
    const d7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d7.push(todayStr(d));
    }
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const sinceStr = todayStr(since);
    return { total: data.length, pct, td, w, d7, per30: data.filter((x) => x.date >= sinceStr).length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myData]);

  const pressPad = (key) => {
    if (key === "del") setPinInput((p) => p.slice(0, -1));
    else if (key === "ok") doLogin();
    else if (pinInput.length < 6 && /[0-9]/.test(key)) setPinInput((p) => p + key);
    setLoginError("");
  };

  if (!currentUser) {
    return (
      <div className="phone">
        <div className="pin-screen">
          <div className="pin-card">
            <div className="pin-logo">
              <i className="fa-solid fa-mosque"></i>
            </div>
            <h2>Absensi Sholat Dzuhur</h2>
            <p className="muted">Masuk dengan NIS &amp; PIN</p>
            <label className="field-label left">
              <i className="fa-solid fa-graduation-cap"></i> NIS
            </label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="Contoh: 25261122"
              maxLength={20}
              value={loginNis}
              onChange={(e) => setLoginNis(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doLogin()}
            />
            <label className="field-label left">
              <i className="fa-solid fa-key"></i> PIN <small className="muted">(4–6 digit)</small>
            </label>
            <div className="pin-dots">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <span key={i} className={i < pinInput.length ? "fill" : ""}></span>
              ))}
            </div>
            <p className="pin-error">{loginError}</p>
            <div className="pin-pad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button key={d} onClick={() => pressPad(d)}>
                  {d}
                </button>
              ))}
              <button className="pin-del" onClick={() => pressPad("del")}>
                <i className="fa-solid fa-delete-left"></i>
              </button>
              <button onClick={() => pressPad("0")}>0</button>
              <button className="pin-ok" onClick={() => pressPad("ok")}>
                <i className="fa-solid fa-check"></i>
              </button>
            </div>
            <button className="btn-primary" onClick={doLogin}>
              Masuk <i className="fa-solid fa-arrow-right"></i>
            </button>
            <p className="pin-hint">{dbStatus}</p>
            <p className="pin-hint">
              Admin: <b>25261122</b> • PIN awal: <b>1234</b>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="phone">
      <div>
        <header className="app-header">
          <div>
            <h1>
              Assalamu&apos;alaikum <i className="fa-solid fa-hand"></i>
            </h1>
            <p>
              {now.toLocaleDateString("id-ID", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}{" "}
              • {now.toLocaleTimeString("id-ID")}
            </p>
            <div className="user-chip">
              <i className="fa-solid fa-graduation-cap"></i> {currentUser.nis} • {currentUser.nama}
              {isAdmin ? " • ADMIN" : ""}
            </div>
          </div>
          <div>
            <div className="header-moon">
              <i className="fa-solid fa-moon"></i>
            </div>
            <button className="btn-logout" onClick={logout}>
              <i className="fa-solid fa-right-from-bracket"></i> Keluar
            </button>
          </div>
        </header>

        <main>
          {page === "home" && (
            <section className="page active">
              <div className="summary-card">
                <div>
                  <small>Sholat Dzuhur Hari Ini</small>
                  <h3>
                    {todayData.length} / 1 Sholat Dzuhur
                  </h3>
                  <div className="progress">
                    <div style={{ width: `${(todayData.length / TARGET_PER_DAY) * 100}%` }}></div>
                  </div>
                </div>
                <div className="summary-icon">
                  <i className="fa-solid fa-mosque"></i>
                </div>
              </div>
              <p className="date-label">{fmtID(today)}</p>
              <div className="prayer-list">
                {PRAYERS.map((p) => {
                  const rec = todayData.find((x) => x.prayer === p.name);
                  return (
                    <div key={p.name} className={`prayer-card ${rec ? "is-done" : ""}`}>
                      <div className="prayer-icon">
                        <i className={p.icon}></i>
                      </div>
                      <div>
                        <b>{p.name}</b>
                        <br />
                        <small>
                          <i className="fa-solid fa-clock"></i> {p.time} •{" "}
                          {rec ? `Absen ${rec.time}` : "Belum absen"}
                        </small>
                      </div>
                      <span className={`status ${rec ? "done" : "todo"}`}>
                        {rec ? (
                          <>
                            <i className="fa-solid fa-circle-check"></i> Sudah Absen
                          </>
                        ) : (
                          <>
                            <i className="fa-regular fa-circle"></i> Belum Absen
                          </>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="quote">
                “Sesungguhnya sholat itu mencegah dari perbuatan keji dan mungkar.”
                <br />
                <span>— QS. Al-Ankabut: 45</span>
              </div>
            </section>
          )}

          {page === "scan" && (
            <section className="page active">
              <h2 className="page-title">
                Scan Absensi Dzuhur <i className="fa-solid fa-camera"></i>
              </h2>
              <label className="field-label">
                Sholat: <i className="fa-solid fa-sun"></i> Dzuhur (1x sehari)
              </label>
              <div className="prayer-chips">
                {PRAYERS.map((p) => {
                  const done = isDone(p.name, today);
                  return (
                    <button key={p.name} className="chip sel" disabled={done} style={done ? { opacity: 0.4 } : {}}>
                      <i className={p.icon}></i> {p.name}
                      {done && (
                        <>
                          {" "}
                          <i className="fa-solid fa-check"></i>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
              <label className="field-label">Scan QR Code Dzuhur</label>
              <div id="reader" className="qr-reader"></div>
              <button className="btn-primary" onClick={startScan}>
                <i className="fa-solid fa-camera"></i> {scanning ? "Kamera aktif… arahkan ke QR" : "Scan QR"}
              </button>
              <button className="btn-ghost" onClick={stopScan}>
                <i className="fa-solid fa-stop"></i> Berhenti Kamera
              </button>
              <div className="divider">atau</div>
              <button className="btn-gold" onClick={() => recordAttendance("Dzuhur")}>
                <i className="fa-solid fa-wand-magic-sparkles"></i> Simulasi Scan Berhasil
              </button>
              <div className="qr-valid-box">
                <p>
                  <b>QR Valid:</b> <code>{VALID_QR[0]}</code>
                </p>
                <img
                  className="demo-qr"
                  width={140}
                  height={140}
                  alt="QR demo valid"
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(
                    VALID_QR[0]
                  )}`}
                />
                <small>Tunjukkan QR ini dari HP lain / print untuk di-scan kamera</small>
              </div>
            </section>
          )}

          {page === "history" && (
            <section className="page active">
              <h2 className="page-title">
                Riwayat <i className="fa-solid fa-scroll"></i>
              </h2>
              {isAdmin && (
                <div className="card">
                  <label className="field-label">
                    <i className="fa-solid fa-magnifying-glass"></i> Filter NIS (Admin)
                  </label>
                  <input
                    type="text"
                    placeholder="Kosong = semua / isi NIS tertentu"
                    value={historyNis}
                    onChange={(e) => setHistoryNis(e.target.value)}
                  />
                </div>
              )}
              <div className="card">
                <label className="field-label">
                  <i className="fa-solid fa-calendar-days"></i> Lihat tanggal tertentu
                </label>
                <input type="date" value={historyDate} onChange={(e) => setHistoryDate(e.target.value)} />
                <div className="row">
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      setHistoryDate(todayStr());
                    }}
                  >
                    Hari ini
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      setHistoryDate("");
                      setHistoryNis("");
                    }}
                  >
                    Semua
                  </button>
                </div>
              </div>
              <div>
                {historyData.length ? (
                  historyData.map((x, i) => (
                    <div key={`${x.nis}-${x.date}-${x.prayer}-${i}`} className="hist-item">
                      <div className="t">
                        <i className="fa-solid fa-sun"></i>
                      </div>
                      <div>
                        <b>{x.prayer}</b>{" "}
                        <small>
                          • {x.nama || ""} ({x.nis})
                        </small>
                        <br />
                        <small>
                          <i className="fa-solid fa-calendar-days"></i> {x.date} •{" "}
                          <i className="fa-solid fa-clock"></i> {x.time}
                        </small>
                      </div>
                      <span className="badge">
                        <i className="fa-solid fa-check"></i> {x.status}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="card muted">
                    Belum ada data. Yuk scan dulu! <i className="fa-solid fa-mosque"></i>
                  </div>
                )}
              </div>
            </section>
          )}

          {page === "stats" && (
            <section className="page active">
              <h2 className="page-title">
                Statistik <i className="fa-solid fa-chart-column"></i>
              </h2>
              <div className="stat-grid">
                <div className="stat-card">
                  <span>
                    <i className="fa-solid fa-circle-check"></i>
                  </span>
                  <h3>{stats.total}</h3>
                  <small>Total Tercatat</small>
                </div>
                <div className="stat-card gold">
                  <span>
                    <i className="fa-solid fa-star"></i>
                  </span>
                  <h3>{stats.pct}%</h3>
                  <small>Kelengkapan</small>
                </div>
              </div>
              <div className="card">
                <b>Rekap 7 Hari Terakhir</b>
                <div className="bars">
                  {stats.d7.map((d) => {
                    const n = myData.filter((x) => x.date === d).length;
                    return (
                      <div key={d} className={`bar ${n >= 1 ? "gold" : ""}`}>
                        <div style={{ height: n >= 1 ? 90 : 6 }}></div>
                        <small>
                          {d.slice(8)}
                          <br />
                          {n}/1
                        </small>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="card">
                <b>Rekap Harian &amp; Mingguan</b>
                <p>
                  Hari ini (Dzuhur): <b>{stats.td}/1</b>
                </p>
                <p>
                  Minggu ini: <b>{stats.w}/{TARGET_PER_WEEK}</b>{" "}
                  <small>({Math.round((stats.w / TARGET_PER_WEEK) * 100)}%)</small>
                </p>
                <div className="progress">
                  <div style={{ width: `${(stats.w / TARGET_PER_WEEK) * 100}%` }}></div>
                </div>
              </div>
              <div className="card">
                <b>Dzuhur 30 hari terakhir</b>
                <div style={{ margin: "8px 0" }}>
                  <small>
                    <i className="fa-solid fa-sun"></i> Dzuhur — <b>{stats.per30}</b>x
                  </small>
                  <div className="progress">
                    <div style={{ width: `${Math.min(100, (stats.per30 / 30) * 100)}%` }}></div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {page === "admin" && isAdmin && (
            <section className="page active">
              <h2 className="page-title">
                Kelola NIS <i className="fa-solid fa-users"></i>
              </h2>
              <div className="card">
                <b>
                  <i className="fa-solid fa-user-plus"></i> Tambah NIS Baru
                </b>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="NIS (angka)"
                  value={newNis}
                  onChange={(e) => setNewNis(e.target.value)}
                />
                <input
                  type="text"
                  placeholder="Nama siswa"
                  value={newNama}
                  onChange={(e) => setNewNama(e.target.value)}
                />
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="PIN awal 4–6 digit (default 1234)"
                  maxLength={6}
                  value={newUserPin}
                  onChange={(e) => setNewUserPin(e.target.value)}
                />
                <button className="btn-primary" onClick={addUser}>
                  Tambah Pengguna
                </button>
                <p className="msg">{adminMsg}</p>
              </div>
              <div className="card">
                <b>
                  Daftar Pengguna (<span>{db.users.length}</span>)
                </b>
                <div>
                  {db.users.map((u) => (
                    <div key={u.nis} className="hist-item">
                      <div className="t">
                        <i className={u.role === "admin" ? "fa-solid fa-crown" : "fa-solid fa-graduation-cap"}></i>
                      </div>
                      <div>
                        <b>{u.nama}</b> <small>({u.role})</small>
                        <br />
                        <small>
                          NIS: {u.nis} • PIN: {u.pin}
                        </small>
                      </div>
                      {String(u.nis) !== ADMIN_NIS && (
                        <button className="btn-mini-danger" onClick={() => delUser(u.nis)}>
                          Hapus
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {page === "settings" && (
            <section className="page active">
              <h2 className="page-title">
                Pengaturan <i className="fa-solid fa-gear"></i>
              </h2>
              <div className="card">
                <b>
                  <i className="fa-solid fa-user"></i> Akun Saya
                </b>
                <p className="muted">
                  {currentUser.nama} — NIS {currentUser.nis} ({isAdmin ? "Admin" : "Siswa"})
                </p>
              </div>
              <div className="card">
                <b>
                  <i className="fa-solid fa-key"></i> Ganti PIN
                </b>
                <input
                  type="password"
                  inputMode="numeric"
                  placeholder="PIN baru 4–6 digit"
                  maxLength={6}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                />
                <input
                  type="password"
                  inputMode="numeric"
                  placeholder="Konfirmasi PIN"
                  maxLength={6}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value)}
                />
                <button className="btn-primary" onClick={changePin}>
                  Simpan PIN Baru
                </button>
                <p className="msg">{pinMsg}</p>
              </div>
              <div className="card">
                <b>
                  <i className="fa-solid fa-trash"></i> Data
                </b>
                <p className="muted">
                  Hapus riwayat <b>akun saya</b> (di database).
                </p>
                <button className="btn-danger" onClick={resetMine}>
                  Hapus Riwayat Saya
                </button>
              </div>
              <div className="card muted small">
                <i className="fa-solid fa-mosque"></i> Absensi Sholat Dzuhur • Next.js
                <br />
                DB: <code>jvault.aerialstudio.tech</code>
                <br />
                QR valid: <code>{VALID_QR[0]}</code>
                <p style={{ marginTop: 6 }}>{syncMsg}</p>
                <button
                  className="btn-ghost"
                  onClick={async () => {
                    setSyncMsg("Menyinkron…");
                    await dbLoad();
                  }}
                >
                  Sinkron Ulang ke Database
                </button>
              </div>
              <button className="btn-ghost" onClick={logout}>
                <i className="fa-solid fa-lock"></i> Kunci / Ganti Akun
              </button>
            </section>
          )}
        </main>

        <nav className="bottom-nav">
          <button className={page === "home" ? "active" : ""} onClick={() => goPage("home")}>
            <i className="fa-solid fa-house"></i>
            <small>Beranda</small>
          </button>
          <button className={page === "scan" ? "active" : ""} onClick={() => goPage("scan")}>
            <i className="fa-solid fa-qrcode"></i>
            <small>Scan</small>
          </button>
          <button className={page === "history" ? "active" : ""} onClick={() => goPage("history")}>
            <i className="fa-solid fa-scroll"></i>
            <small>Riwayat</small>
          </button>
          <button className={page === "stats" ? "active" : ""} onClick={() => goPage("stats")}>
            <i className="fa-solid fa-chart-column"></i>
            <small>Statistik</small>
          </button>
          {isAdmin && (
            <button className={page === "admin" ? "active" : ""} onClick={() => goPage("admin")}>
              <i className="fa-solid fa-users"></i>
              <small>Kelola</small>
            </button>
          )}
          <button className={page === "settings" ? "active" : ""} onClick={() => goPage("settings")}>
            <i className="fa-solid fa-gear"></i>
            <small>Akun</small>
          </button>
        </nav>
      </div>

      {!success ? null : (
        <div className="modal">
          <div className="modal-card">
            <div className="check">
              <i className="fa-solid fa-circle-check"></i>
            </div>
            <h3>
              Alhamdulillah,
              <br />
              absensi berhasil!
            </h3>
            <p>
              {success.prayer} • {currentUser.nama} ({currentUser.nis}) • {success.dateLabel} • {success.time}
              {success.pending ? " (tersimpan lokal, menunggu sinkron)" : ""}
              {!cloudOK && !success.pending ? " (periksa status sinkron di Pengaturan)" : ""}
            </p>
            <button className="btn-primary" onClick={() => setSuccess(null)}>
              MasyaAllah <i className="fa-solid fa-hands-praying"></i>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
