# Absensi Sholat Dzuhur • Next.js 🕌

Aplikasi absensi Sholat Dzuhur: login NIS + PIN, scan QR, riwayat, statistik, kelola NIS (admin).

## Menjalankan

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # verifikasi production
npm start       # jalankan hasil build
```

> Kamera & fetch database butuh `http://localhost` / HTTPS. Jangan buka via `file://`.

## Akun

- Login: **NIS + PIN** (PIN via numpad 4–6 digit).
- Admin: NIS `25261122`, PIN awal `1234`. Menu **Kelola** hanya untuk admin (tambah/hapus NIS).
- 1 NIS = absen Dzuhur 1x sehari.

## Database (JsonVault)

- Base `https://jvault.aerialstudio.tech/`, Bin `083eb68b-21d7-4a74-b8ce-d3fe1b9e9368`.
- Baca `GET api?bin_id=...`, tulis `PATCH api?bin_id=...&action=merge` (fallback replace/PUT/POST + verifikasi baca ulang).
- Struktur: `{ users: [{nis, nama, pin, role}], attendance: [{nis, nama, prayer, date, time, status}] }`.
- API key di `app/page.jsx` (`API_KEY`). Kalau gagal sinkron, pesan error persis tampil di Pengaturan + alert; data selalu aman di `localStorage`.

## Struktur

- `app/layout.jsx` — layout + FontAwesome
- `app/globals.css` — tema hijau/putih/emas
- `app/page.jsx` — seluruh aplikasi (client component)
- `legacy/` — versi HTML vanilla lama (arsip)
