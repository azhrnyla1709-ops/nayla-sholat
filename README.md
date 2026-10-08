# Absensi Sholat • NIS + jvault 🕌

## Login
- Masuk dengan **NIS + PIN** (PIN via numpad, 4–6 digit).
- Admin: NIS `25261122`, PIN awal `1234`.
- NIS salah → "NIS tidak terdaftar." PIN salah → "PIN salah, coba lagi."

## Admin
- Menu **Kelola 👥** hanya muncul untuk admin.
- Tambah NIS baru: isi NIS + Nama + PIN awal → tersimpan ke database.
- Hapus NIS (kecuali admin utama) + riwayatnya.
- Di Riwayat, admin bisa filter per NIS.

## Database (JsonVault resmi)
- Base: `https://jvault.aerialstudio.tech/`, Bin: `083eb68b-...`
- Baca: `GET api?bin_id=BIN` + header `X-API-Key`
- Tulis: `PATCH api?bin_id=BIN&action=merge` + body `{ users, attendance }`
- Struktur JSON:
```json
{
  "users": [{ "nis": "25261122", "nama": "Admin", "pin": "1234", "role": "admin", "createdAt": "..." }],
  "attendance": [{ "nis": "25261122", "nama": "Admin", "prayer": "Subuh", "date": "2026-10-08", "time": "04:35:00", "status": "Sudah Absen" }]
}
```
- Aplikasi `GET` saat dibuka, lalu `PUT` (fallback `POST`/`PATCH`) setiap ada perubahan.
- Jika cloud tidak terjangkau (offline/CORS/Cloudflare), otomatis **mode lokal** via `localStorage asp_cloud_backup` + sesi `asp_session_nis`. Status tampil di login & Pengaturan.

## Menjalankan
Buka `index.html` (disarankan via `npx serve .` agar kamera & fetch stabil).
