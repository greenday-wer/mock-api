# Koperasi Mock API — Neraca Lajur

Server **Node.js + Express** yang meniru API koperasi, dipakai untuk menguji
integrasi **SIMKOPDA** saat server endpoint asli sedang _down_. Menyediakan:

- **Neraca lajur** (trial balance) — untuk prefill laporan keuangan.
- **Produk & layanan** per koperasi — daftar **produk simpanan** & **produk pinjaman**, plus **simulasi**.

Data **5 koperasi** berbeda dengan **tahun buku 2020–2026**. Untuk neraca, setiap
kombinasi koperasi + tahun menghasilkan angka yang:

- **deterministik** — sama setiap kali dipanggil (pengujian dapat diulang),
- **balance** — total aset = total liabilitas + ekuitas (exact),
- **konsisten double-entry** — `saldo_akhir = saldo_awal ± (debit − kredit)`,
- **kontinu antar-tahun** — saldo awal tahun N = saldo akhir tahun N−1,
- **per-periode** — neraca ditarik _year-to-date_ sampai `tanggal_sampai`, jadi
  triwulan / semester / tahunan menghasilkan nilai berbeda (lihat §4).

> Folder ini sengaja **terpisah** dari proyek SIMKOPDA agar bisa di-host sendiri,
> seolah-olah berasal dari server/endpoint lain.

---

## 1. Menjalankan secara lokal

```bash
cd koperasi-mock-api
npm install
npm start
# -> Koperasi MOCK API berjalan di http://localhost:4000
```

Cek daftar koperasi & contoh URL:

```bash
curl http://localhost:4000/
```

Verifikasi semua periode balance:

```bash
npm run check
```

---

## 2. Kontrak endpoint (sama seperti API asli)

Header opsional (diterima ketiganya): `api-key`, `x-api-key`, `api_key`.
Tiap endpoint punya **dua bentuk** rute:

| Bentuk | Cara pilih koperasi |
|---|---|
| **Per-koperasi (path)** — disarankan, mis. `/api/KOP03/...` | kode di path |
| **Kanonik**, mis. `/v1/without-auth/...` | `?koperasi=KOP03` atau header `api-key` |

Daftar endpoint (slug di SIMKOPDA → path mock):

| Slug SIMKOPDA | Method | Path mock (bentuk per-koperasi) |
|---|---|---|
| `neraca_lajur` | GET | `/api/{KODE}/v1/without-auth/jurnal-umum/neraca-lajur?tanggal_dari=&tanggal_sampai=` |
| `simpanan` | GET | `/api/{KODE}/v1/without-auth/simpanan` |
| `pinjaman` | GET | `/api/{KODE}/v1/without-auth/pinjaman` |
| `simpanan_simulasi` | POST | `/api/{KODE}/v1/without-auth/simpanan/{id}/simulasi` |
| `pinjaman_simulasi` | POST | `/api/{KODE}/v1/without-auth/pinjaman/{id}/simulasi` |

> Filter opsional pada daftar produk (sama seperti param SIMKOPDA): `skema`, `nama`, `kode`, `buka`.
> Simulasi menerima body form/JSON: `nominal` (rupiah) & `durasi` (bulan).

### Contoh response (dipotong)

```json
{
  "success": true,
  "message": "Berhasil mengambil neraca lajur (MOCK)",
  "koperasi": { "kode": "KOP03", "nama": "KSP Artha Mandiri" },
  "buku_periode": { "tahun_periode": 2024, "tanggal_dari": "2024-01-01", "tanggal_sampai": "2024-12-31", "status": "aktif" },
  "meta": { "tgl_dari": "2024-01-01", "tgl_sampai": "2024-12-31", "tahun_diminta": 2024, "out_of_range": false, "total_akun": 31, "sumber": "koperasi-mock-api" },
  "data": [
    { "kode_akun": "111010000", "nama_akun": "Kas", "kelompok": "Aset Lancar", "saldo_normal": "debit", "tipe_akun": 2, "saldo_awal": 0, "debit": 0, "kredit": 0, "saldo_akhir": 0 }
  ]
}
```

Field yang dibaca SIMKOPDA: `kode_akun`, `nama_akun`, `saldo_awal`, `debit`,
`kredit`, `saldo_akhir`, `tipe_akun`, serta `buku_periode.tahun_periode`.

### Contoh produk simpanan (dipotong)

`GET /api/KOP02/v1/without-auth/simpanan`

```json
{
  "success": true,
  "message": "Data simpanan berhasil diambil",
  "data": [
    {
      "id": 202, "nama": "Simpanan Berjangka", "kode": "KOP02-S02",
      "skema": "berjangka", "buka": true, "deskripsi": "...",
      "jenis_simpanan": { "nama": "Deposito" },
      "detail": {
        "setor": { "setoran_awal": { "jumlah": 1250000 }, "nominal": { "jumlah": 1250000 } },
        "tarik": { "saldo_minimal": 0 },
        "biaya": { "administrasi": { "nominal": 0 } },
        "bunga": { "suku_bunga": [ { "tingkat": [ {"jumlah":"5.42"}, {"jumlah":"6.44"}, {"jumlah":"7.27"} ] } ] }
      }
    }
  ]
}
```

Produk pinjaman serupa (tambahan `detail.plafon`, `detail.jangka_waktu`).
Simulasi: `POST /api/KOP02/v1/without-auth/pinjaman/251/simulasi` body `nominal=10000000&durasi=12`
→ `{ data: { angsuran_per_bulan, total_bunga, total_pembayaran, jadwal:[...] }, message }`.

> Jumlah produk & angka bervariasi per koperasi (koperasi besar → plafon/minimum
> lebih tinggi), dan sebagian produk sengaja `buka:false` untuk menguji filter.

---

## 3. Daftar koperasi

| Kode | Nama | Skala (≈ total aset 2020) | api-key |
|---|---|---|---|
| `KOP01` | Koperasi Simpan Pinjam Sejahtera Bersama | Rp 800 jt  | `mock-key-kop01` |
| `KOP02` | Koperasi Serba Usaha Maju Jaya           | Rp 1,8 M   | `mock-key-kop02` |
| `KOP03` | KSP Artha Mandiri                        | Rp 3,5 M   | `mock-key-kop03` |
| `KOP04` | Koperasi Karyawan Nusantara              | Rp 6,5 M   | `mock-key-kop04` |
| `KOP05` | KSP Mitra Sentosa                        | Rp 12 M    | `mock-key-kop05` |

Ubah profil/skala di [`src/koperasi.js`](src/koperasi.js). Bagan akun & nama di
[`src/accounts.js`](src/accounts.js). Logika angka di [`src/generator.js`](src/generator.js).

---

## 4. Tahun buku, periode laporan & out-of-range

### Tahun buku & out-of-range
- Tahun **2020–2026** → data tersedia, `tahun_periode` = tahun diminta.
- Tahun di luar rentang (mis. **2019 / 2027**) → server mengembalikan tahun aktif
  terdekat (2020 atau 2026). SIMKOPDA akan menampilkan pesan _"Data tahun X tidak
  tersedia, buku periode aktif tahun Y"_ — berguna untuk menguji jalur tersebut.

### Periode laporan (tahunan / semester / triwulan)
Neraca lajur ditarik **year-to-date** dari awal tahun buku sampai `tanggal_sampai`
(tanggal cut-off). Jadi nilai neraca **berbeda menurut periode** yang diminta:

| Periode | `tanggal_dari` → `tanggal_sampai` | Fraksi tahun (≈) |
|---|---|---|
| Triwulan I | `2024-01-01` → `2024-03-31` | 0,25 |
| Semester I | `2024-01-01` → `2024-06-30` | 0,50 |
| Triwulan III (s/d) | `2024-01-01` → `2024-09-30` | 0,75 |
| Tahunan | `2024-01-01` → `2024-12-31` | 1,00 |

Cara angka dibentuk:
- **Akun permanen** (aktiva/kewajiban/modal) — saldo di-interpolasi linear antara
  saldo awal tahun (= tutup buku tahun lalu) dan saldo akhir tahun penuh, sesuai
  fraksi hari yang sudah berjalan. **Kas tetap penyeimbang**, sehingga neraca
  **selalu balance di periode mana pun**.
- **Akun nominal** (pendapatan/biaya) — terakumulasi proporsional terhadap fraksi
  tahun (Triwulan I ≈ ¼ nilai setahun, Semester I ≈ ½, dst).

> Fraksi dihitung dari **hari** (`tanggal_sampai`), bukan bulan bulat, jadi mis.
> `…-03-31` ≈ 0,247. `tanggal_dari` di luar 1 Januari juga didukung (mis. hanya
> Triwulan II: `04-01` → `06-30`) — kolom debit/kredit menampilkan mutasi jendela
> itu saja. Permintaan **setahun penuh hasilnya identik** dengan versi sebelumnya.
>
> Catatan: `buku_periode.lama_periode_bulan` tetap **12** karena itu definisi
> _tahun buku_ (bukan panjang jendela yang diminta). Cek balance per periode:
> `…/debug/balance?tanggal_dari=2024-01-01&tanggal_sampai=2024-06-30`.

---

## 5. Menghubungkan ke SIMKOPDA

Di SIMKOPDA (login admin):

1. **Master Data → Mapping Neraca Lajur API** harus sudah terisi mapping default
   (kode_akun 9 digit). Bila belum, jalankan di server SIMKOPDA:
   ```bash
   php artisan db:seed --class="Database\Seeders\NeracaLajurMappingSeeder" --force
   ```
   Mock ini sudah memakai kode_akun yang **persis** sama dengan mapping tersebut.

2. **Pengaturan Integrasi → pilih koperasi → Daftar Endpoint API**: tamb/edit
   endpoint dengan URL mock. Untuk KOP03 misalnya:

   | Kategori/slug | URL |
   |---|---|
   | `neraca_lajur` | `http://IP_MOCK:4000/api/KOP03/v1/without-auth/jurnal-umum/neraca-lajur` |
   | `simpanan` | `http://IP_MOCK:4000/api/KOP03/v1/without-auth/simpanan` |
   | `pinjaman` | `http://IP_MOCK:4000/api/KOP03/v1/without-auth/pinjaman` |
   | `simpanan_simulasi` | `http://IP_MOCK:4000/api/KOP03/v1/without-auth/simpanan/{id}/simulasi` |
   | `pinjaman_simulasi` | `http://IP_MOCK:4000/api/KOP03/v1/without-auth/pinjaman/{id}/simulasi` |

   Biarkan placeholder `{id}` apa adanya pada slug simulasi — SIMKOPDA yang
   menggantinya dengan id produk. (opsional) isi `api_key` = `mock-key-kop03`.
   Lakukan untuk tiap koperasi dengan kode sesuai (KOP01..KOP05).

3. **Neraca**: buka halaman tarik laporan, pilih tahun 2020–2026, **Tarik data** →
   field neraca terisi otomatis.
   **Produk & layanan**: buka **Pemetaan Simpanan/Portal** → produk simpanan &
   pinjaman koperasi akan termuat dari mock; aktifkan yang ingin ditampilkan di
   portal publik, lalu uji simulasi.

> Catatan: kolom `debit`/`kredit` & `saldo_awal` juga diisi konsisten, sehingga
> laporan **Arus Kas** dan **Perubahan Ekuitas** ikut dapat diuji.

---

## 6. Hosting

**Opsi A — PM2 (paling umum di VPS):**
```bash
npm install
npm install -g pm2
pm2 start server.js --name koperasi-mock-api
pm2 save
```

**Opsi B — Docker:**
```bash
docker build -t koperasi-mock-api .
docker run -d -p 4000:4000 --name koperasi-mock-api koperasi-mock-api
```

**Opsi C — node biasa:** `PORT=4000 node server.js`

Bila di-proxy lewat Nginx, arahkan sebuah `server_name`/subdomain ke
`http://127.0.0.1:4000`. Pastikan port 4000 dibuka di firewall bila diakses langsung.

### Variabel lingkungan

| Var | Default | Keterangan |
|---|---|---|
| `PORT` | `4000` | Port server |
| `REQUIRE_API_KEY` | `false` | Bila `true`, request wajib menyertakan `api-key` yang cocok dengan koperasi |
