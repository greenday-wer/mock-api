# Alur Deploy: Push (lokal) → Pull (VPS) → Hosting (VPS terpisah)

Alur lengkap menaruh kode dari laptop ke **VPS khusus** (terpisah dari server
sistem utama) lewat GitHub. Detail tiap langkah hosting ada di [DEPLOY.md](DEPLOY.md);
file ini fokus ke **urutan kerjanya**.

```
[Laptop Windows]  ──git push──►  [GitHub repo (privat)]  ──git pull/clone──►  [VPS mock khusus]
                                                                                 └─ PM2 + Nginx + HTTPS
```

> 🔒 Repo sebaiknya **PRIVAT** karena `src/koperasi.js` berisi API key. Atau,
> generate ulang key (Lampiran B DEPLOY.md) sebelum push bila repo publik.
> `.gitignore` sudah mengecualikan `node_modules/` dan `.env`.

---

## FASE 1 — LOKAL (Windows): siapkan Git & PUSH ke GitHub

Lakukan di folder proyek (`koperasi-mock-api`) lewat PowerShell.

```powershell
# 1. Pastikan Git terpasang
git --version

# 2. (sekali saja) set identitas commit
git config --global user.name  "Nama Anda"
git config --global user.email "email@anda.com"

# 3. Inisialisasi repo & commit pertama
git init
git add .
git commit -m "koperasi-mock-api: initial"
git branch -M main
```

4. Buat repo kosong di GitHub: **github.com → New repository** → nama
   `koperasi-mock-api` → **Private** → Create (jangan centang README/gitignore).

5. Hubungkan & push (pilih SSH **atau** HTTPS):

```powershell
# --- Opsi SSH (disarankan; perlu SSH key laptop terdaftar di GitHub) ---
git remote add origin git@github.com:USERNAME/koperasi-mock-api.git
git push -u origin main

# --- Opsi HTTPS (login pakai Personal Access Token saat diminta password) ---
# git remote add origin https://github.com/USERNAME/koperasi-mock-api.git
# git push -u origin main
```

> SSH key laptop belum ada? `ssh-keygen -t ed25519 -C "laptop"` lalu tempel isi
> `~/.ssh/id_ed25519.pub` ke **GitHub → Settings → SSH and GPG keys**.

---

## FASE 2 — VPS BARU (terpisah): PULL & HOSTING

VPS ini khusus mock, jadi tidak ada risiko tabrakan dengan sistem utama.

### 2.1 Login & paket dasar
```bash
ssh root@IP_VPS_BARU
apt update && apt upgrade -y
apt install -y curl git ufw nginx
```

### 2.2 Node.js 20 + PM2
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pm2
node -v && pm2 -v
```

### 2.3 Akses Git untuk PULL (pilih satu)

**Opsi A — Deploy Key (disarankan, read-only, tanpa password):**
```bash
ssh-keygen -t ed25519 -C "vps-mock-deploy" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```
Salin output → **GitHub repo → Settings → Deploy keys → Add deploy key**
(beri nama, JANGAN centang "Allow write access"). Lalu uji:
```bash
ssh -T git@github.com        # ketik "yes" untuk simpan fingerprint
```

**Opsi B — HTTPS + Personal Access Token** (clone pakai URL https, isi token saat diminta).

### 2.4 Clone (PULL pertama)
```bash
mkdir -p /var/www && cd /var/www
git clone git@github.com:USERNAME/koperasi-mock-api.git    # atau URL https
cd koperasi-mock-api
```

### 2.5 Install dependency & uji
```bash
npm ci --omit=dev
npm run check                # harus "Semua periode BALANCE"
```

### 2.6 Jalankan dengan PM2 (auto-restart + auto-boot)
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup                  # jalankan perintah systemd yang ditampilkan
pm2 save
pm2 status
```

### 2.7 Firewall
```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

### 2.8 Nginx reverse proxy (domain penuh — VPS khusus)
```bash
cp deploy/nginx.conf.example /etc/nginx/sites-available/koperasi-mock-api
nano /etc/nginx/sites-available/koperasi-mock-api      # ganti server_name -> domain Anda
ln -s /etc/nginx/sites-available/koperasi-mock-api /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

### 2.9 DNS
Buat **A record** domain/subdomain → **IP VPS baru**. Tunggu propagasi.

### 2.10 HTTPS
```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d domain-anda.id        # pilih redirect HTTP->HTTPS
```

### 2.11 Verifikasi
```bash
curl -H "api-key: base64:MASTER_DATA_KEY" \
  https://domain-anda.id/api/KOP01/v1/without-auth/informasi-koperasi
```
Buka `https://domain-anda.id/` untuk daftar URL + key.

---

## FASE 3 — UPDATE rutin (push → pull → reload)

**Di laptop** setiap ada perubahan:
```powershell
git add .
git commit -m "ubah X"
git push
```

**Di VPS** tarik perubahan & reload (tanpa downtime):
```bash
cd /var/www/koperasi-mock-api
bash deploy/update.sh        # = git pull + npm ci + pm2 reload
```

Atau manual:
```bash
git pull --ff-only
npm ci --omit=dev
pm2 reload koperasi-mock-api
```

---

## Ringkasan satu layar

| Fase | Tempat | Perintah inti |
|---|---|---|
| 1. Push | Laptop | `git init` → `commit` → `git remote add` → `git push -u origin main` |
| 2. Hosting | VPS baru | install Node+PM2+Nginx → `git clone` → `npm ci` → `pm2 start` → Nginx → Certbot |
| 3. Update | Laptop→VPS | laptop: `git push` · VPS: `bash deploy/update.sh` |
