# Deploy koperasi-mock-api ke Hostinger VPS

Panduan hosting mock API ini di **Hostinger VPS** (paket KVM, OS Ubuntu) memakai
**Node.js + PM2 + Nginx (reverse proxy) + HTTPS Let's Encrypt**.

## Arsitektur

```
Internet ──HTTPS(443)/HTTP(80)──►  Nginx (reverse proxy)
                                      │  proxy_pass
                                      ▼
                              127.0.0.1:4000  ─ Node.js (PM2)
```

Node hanya mendengarkan di port internal **4000** (di-firewall dari publik); Nginx
yang menghadap internet + meng-handle TLS. Sertifikat HTTPS dari Let's Encrypt
(gratis, auto-renew).

---

## ⚠️ Berdampingan dengan project utama (Laravel/SIMKOPDA) — TANPA tabrakan

Jika VPS sudah menjalankan aplikasi lain (mis. SIMKOPDA/Laravel di Nginx + PHP-FPM),
mock ini **tidak akan bentrok** asalkan 5 hal berikut DIBEDAKAN:

| Aspek | Project utama (Laravel) | Mock ini | Bentrok? |
|---|---|---|---|
| **Folder** | mis. `/var/www/simkopda` | `/var/www/koperasi-mock-api` (folder lain) | Tidak |
| **Runtime/proses** | PHP-FPM | Node.js + **PM2** (nama app `koperasi-mock-api`) | Tidak (beda runtime) |
| **Port internal** | PHP-FPM socket | TCP **4000** (atau lain bila 4000 dipakai) | Tidak, selama port bebas |
| **Nginx** | `server {}` block domain utama | `server {}` block **subdomain baru** | Tidak — Nginx route per `server_name` |
| **Domain/SSL** | `domainutama.id` | `mock-api.domainutama.id` (subdomain terpisah) | Tidak |

**Prinsip:** mock berjalan sebagai proses Node sendiri di port sendiri, lalu Nginx
menambah **satu server block lagi** (subdomain) yang mem-`proxy_pass` ke port itu.
File aplikasi utama, port-nya, PHP-FPM, dan database **tidak disentuh sama sekali**.

### Diagnosa dulu (jalankan SEBELUM instal, agar tidak salah tempat)

```bash
# 1. Node & PM2 sudah ada? (Laravel kadang sudah pasang Node utk Vite)
node -v 2>/dev/null; which node; pm2 -v 2>/dev/null

# 2. Port 4000 bebas? (tidak boleh ada output untuk :4000)
ss -tlnp | grep ':4000' || echo "Port 4000 BEBAS"

# 3. Lihat domain/vhost yang sudah ada (jangan pakai server_name yang sama)
ls -l /etc/nginx/sites-enabled/
grep -R "server_name" /etc/nginx/sites-available/ 2>/dev/null

# 4. Di mana app utama? (cari root Laravel)
ls /var/www
```

Aturan dari hasil diagnosa:
- **Node sudah ada** → lewati langkah 3 (NodeSource). Pakai yang ada. (Jika Node dipakai via `nvm`, pastikan `pm2` jalan dengan node yang sama.)
- **PM2 belum ada** → `npm install -g pm2`. Jika sudah ada, langsung pakai (nama app `koperasi-mock-api` unik, tidak menimpa proses lain).
- **Port 4000 dipakai** → ganti `PORT` di `ecosystem.config.js` (mis. `4010`) **dan** `proxy_pass` di Nginx ke port yang sama.
- **Nginx**: BUAT FILE BARU `/etc/nginx/sites-available/koperasi-mock-api` dengan `server_name` **subdomain berbeda** dari app utama. JANGAN edit/hapus vhost app utama, dan JANGAN hapus `sites-enabled/default` jika itu dipakai app lain.
- **DNS**: tambah A record **subdomain baru** → IP VPS yang sama.
- **Certbot**: terbitkan cert HANYA untuk subdomain baru: `certbot --nginx -d mock-api.domainutama.id`. Cert domain utama tidak terpengaruh.

### Alternatif paling aman: tanpa subdomain (jika SIMKOPDA satu VPS dengan mock)

Kalau SIMKOPDA yang memanggil mock **berada di VPS yang sama**, paling bersih: mock
cukup didengarkan di localhost dan SIMKOPDA memanggilnya via `http://127.0.0.1:4000`.
Tidak perlu Nginx vhost, subdomain, DNS, maupun sertifikat untuk mock.

```bash
# Jalankan mock (langkah 6–8), lalu di SIMKOPDA isi URL endpoint dengan:
#   http://127.0.0.1:4000/api/KOP01/v1/without-auth/...
```

> Lewati langkah 9–13 (firewall publik/Nginx/DNS/HTTPS) untuk mode ini. Cocok bila
> kamu hanya butuh SIMKOPDA membaca data mock, bukan akses dari Postman/laptop.
> (Untuk uji dari Postman/laptop, pakai mode subdomain di bawah.)

---

## 0. Prasyarat

- VPS Hostinger aktif. OS **Ubuntu 22.04 / 24.04** (pilih template Ubuntu Plain saat setup VPS di hPanel).
- Data SSH: **IP VPS**, user `root`, password/SSH key — ada di **hPanel → VPS → SSH Access**.
- (Opsional, untuk HTTPS) sebuah **domain/subdomain** yang DNS-nya bisa diarahkan ke IP VPS, mis. `koperasi-mock.contoh.id`. Tanpa domain, tetap bisa diakses via `http://IP_VPS`.

> ⚠️ **Keamanan**: API key default ada di `src/koperasi.js`. Karena sudah pernah
> terlihat (chat/README), **generate ulang sebelum produksi** (lihat Lampiran B).

---

## 1. Login SSH ke VPS

Dari PowerShell / terminal lokal:

```bash
ssh root@IP_VPS
```

(Hostinger juga menyediakan **Browser terminal** di hPanel → VPS → Overview.)

## 2. Update sistem & paket dasar

```bash
apt update && apt upgrade -y
apt install -y curl git ufw unzip
```

## 3. Install Node.js LTS (v20, via NodeSource)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v && npm -v        # pastikan keluar versi (mis. v20.x)
```

## 4. Install PM2 (process manager)

```bash
npm install -g pm2
```

---

## 5. Upload kode ke VPS — pilih SATU opsi

### Opsi A — Git (paling rapi, mudah update)

1. Di komputer lokal (sekali saja), jadikan folder ini repo & push ke GitHub (boleh private):

   ```powershell
   # di folder koperasi-mock-api
   git init
   git add .
   git commit -m "koperasi-mock-api"
   git branch -M main
   git remote add origin https://github.com/USERNAME/koperasi-mock-api.git
   git push -u origin main
   ```

2. Di VPS:

   ```bash
   mkdir -p /var/www && cd /var/www
   git clone https://github.com/USERNAME/koperasi-mock-api.git
   cd koperasi-mock-api
   ```

### Opsi B — Upload ZIP via SCP dari Windows (tanpa GitHub)

1. Di PowerShell lokal (di dalam folder proyek), buat ZIP **tanpa** `node_modules`:

   ```powershell
   Get-ChildItem -Path . -Exclude node_modules,.git |
     Compress-Archive -DestinationPath "$env:TEMP\koperasi-mock-api.zip" -Force
   scp "$env:TEMP\koperasi-mock-api.zip" root@IP_VPS:/var/www/
   ```

2. Di VPS:

   ```bash
   cd /var/www
   mkdir -p koperasi-mock-api
   unzip koperasi-mock-api.zip -d koperasi-mock-api
   cd koperasi-mock-api
   ```

### Opsi C — SFTP (FileZilla) / File Manager hPanel

Upload seluruh folder (kecuali `node_modules`) ke `/var/www/koperasi-mock-api`.

---

## 6. Install dependency produksi

```bash
cd /var/www/koperasi-mock-api
npm ci --omit=dev        # pakai package-lock; jika error, pakai: npm install --omit=dev
```

## 7. Uji cepat (sebelum dijadikan service)

```bash
npm run check            # cek neraca BALANCE 2020-2026 (harus "Semua periode BALANCE")
PORT=4000 REQUIRE_API_KEY=true node server.js
```

Di terminal lain (atau buka tab SSH baru) uji lokal:

```bash
curl -s http://127.0.0.1:4000/health
```

Hentikan dengan `Ctrl+C`.

## 8. Jalankan permanen dengan PM2

```bash
pm2 start ecosystem.config.js     # PORT & REQUIRE_API_KEY diambil dari file ini
pm2 status
pm2 logs koperasi-mock-api --lines 20
pm2 save                           # simpan daftar proses
pm2 startup                        # ikuti perintah yang ditampilkan (untuk auto-start saat reboot)
pm2 save                           # simpan lagi setelah startup di-set
```

---

## 9. Firewall (UFW)

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'             # buka 80 & 443
ufw enable
ufw status
```

> Port **4000 sengaja TIDAK dibuka** ke publik — hanya diakses Nginx via 127.0.0.1.
> Cek juga **firewall Hostinger** di hPanel (VPS → Firewall): pastikan 80 & 443 (dan 22) terbuka.

## 10. Nginx sebagai reverse proxy

```bash
apt install -y nginx
```

Salin contoh config, lalu ganti `server_name`:

```bash
cp /var/www/koperasi-mock-api/deploy/nginx.conf.example /etc/nginx/sites-available/koperasi-mock-api
nano /etc/nginx/sites-available/koperasi-mock-api   # ubah: server_name koperasi-mock.contoh.id;
```

Aktifkan & reload:

```bash
ln -s /etc/nginx/sites-available/koperasi-mock-api /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default               # opsional: matikan situs default
nginx -t && systemctl reload nginx
```

Sekarang `http://domain-anda` (atau `http://IP_VPS`) sudah mengarah ke app.

## 11. Arahkan domain (DNS)

Di pengelola DNS domain Anda, buat **A record**:

| Type | Name | Value |
|------|------|-------|
| A    | koperasi-mock (atau @) | `IP_VPS` |

Tunggu propagasi (beberapa menit). Cek: `ping koperasi-mock.contoh.id`.

## 12. Aktifkan HTTPS (Let's Encrypt)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d koperasi-mock.contoh.id          # ganti dengan domain Anda
```

Pilih opsi **redirect HTTP → HTTPS**. Auto-renew sudah aktif (systemd timer); uji:

```bash
certbot renew --dry-run
```

---

## 13. Verifikasi dari luar (dengan API key)

Master data (key global — ganti dengan milik Anda dari `src/koperasi.js`):

```bash
curl -H "api-key: base64:MASTER_DATA_KEY" \
  https://koperasi-mock.contoh.id/api/KOP03/v1/without-auth/informasi-koperasi
```

Neraca lajur (key **akuntansi KOP03**):

```bash
curl -H "api-key: base64:KEY_AKUNTANSI_KOP03" \
  "https://koperasi-mock.contoh.id/api/KOP03/v1/without-auth/jurnal-umum/neraca-lajur?tanggal_dari=2023-01-01&tanggal_sampai=2023-12-31"
```

- Tanpa/with key salah → **401**.
- Buka `https://koperasi-mock.contoh.id/` di browser → daftar semua URL + key per koperasi.

## 14. Setup di SIMKOPDA (server lain)

Di **Pengaturan Integrasi → Daftar Endpoint API**, isi URL VPS ini:

| Kategori | URL (per koperasi `{KODE}` = KOP01..KOP05) | API Key |
|---|---|---|
| informasi_koperasi | `https://domain/api/{KODE}/v1/without-auth/informasi-koperasi` | master data key |
| simpanan | `https://domain/api/{KODE}/v1/without-auth/simpanan` | master data key |
| pinjaman | `https://domain/api/{KODE}/v1/without-auth/pinjaman` | master data key |
| simpanan_simulasi | `https://domain/api/{KODE}/v1/without-auth/simpanan/{id}/simulasi` | master data key |
| pinjaman_simulasi | `https://domain/api/{KODE}/v1/without-auth/pinjaman/{id}/simulasi` | master data key |
| neraca_lajur | `https://domain/api/{KODE}/v1/without-auth/jurnal-umum/neraca-lajur` | **key akuntansi koperasi tsb** |

---

## 15. Update / redeploy

**Git (Opsi A):**

```bash
cd /var/www/koperasi-mock-api
git pull
npm ci --omit=dev
pm2 reload koperasi-mock-api
```

**ZIP/SFTP (Opsi B/C):** upload ulang file, lalu `pm2 reload koperasi-mock-api`.

## 16. Perintah berguna

```bash
pm2 status                 # status proses
pm2 logs koperasi-mock-api # log realtime
pm2 reload koperasi-mock-api   # restart tanpa downtime
pm2 restart koperasi-mock-api
pm2 monit                  # monitor CPU/mem
systemctl reload nginx     # reload Nginx
```

## 17. Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| **502 Bad Gateway** | App mati / port salah. Cek `pm2 status` & `pm2 logs`. Pastikan app di 4000 dan `proxy_pass` Nginx juga 4000. |
| **Selalu 401** | Header `api-key` salah, atau pakai master key untuk neraca (neraca butuh key **akuntansi**). Cek `REQUIRE_API_KEY`. Untuk sementara matikan: ubah `REQUIRE_API_KEY` ke `'false'` di `ecosystem.config.js` lalu `pm2 reload`. |
| **Port 4000 dipakai** | Ubah `PORT` di `ecosystem.config.js` **dan** `proxy_pass` di Nginx, lalu reload keduanya. |
| **SIMKOPDA gagal SSL** | SIMKOPDA memakai `Http::withoutVerifying()` (menerima self-signed), tapi sebaiknya pakai Let's Encrypt agar valid di browser. |
| **DNS belum jalan** | `certbot` butuh domain sudah mengarah ke IP. Tunggu propagasi DNS dulu. |

---

## Lampiran A — Alternatif: Docker

Tersedia `Dockerfile`. Jika lebih suka container:

```bash
docker build -t koperasi-mock-api .
docker run -d --name koperasi-mock --restart unless-stopped \
  -p 127.0.0.1:4000:4000 -e REQUIRE_API_KEY=true koperasi-mock-api
```

Lalu tetap pasang Nginx (langkah 10–12) sebagai reverse proxy ke `127.0.0.1:4000`.

## Lampiran B — Generate ulang API key (disarankan untuk produksi)

```bash
node -e "const c=require('crypto');const k=()=>'base64:'+c.randomBytes(32).toString('base64');console.log('MASTER =',k());for(let i=1;i<=5;i++)console.log('KOP0'+i+' =',k());"
```

Tempel hasilnya ke `src/koperasi.js` (`MASTER_DATA_API_KEY` dan `apiKey` tiap koperasi),
lalu `pm2 reload koperasi-mock-api`.
