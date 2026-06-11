'use strict';

/**
 * Mock API koperasi (master data + akuntansi) untuk menguji integrasi SIMKOPDA.
 * Meniru kontrak server asli (lihat respons contoh dari server produksi):
 *
 *   GET {host}/v1/without-auth/informasi-koperasi
 *       -> { message, data:{ informasi:{id,nama,alamat,email,telepon,logo},
 *            created_at, updated_at }, auth }
 *
 *   GET {host}/v1/without-auth/simpanan | /pinjaman
 *       -> { message, data:[ {id,nama,kode,skema,buka,deskripsi,detail{...},
 *            created_at,updated_at,jenis_simpanan,organisasi} ], auth }
 *
 *   GET {host}/v1/without-auth/jurnal-umum/neraca-lajur
 *       ?tanggal_dari=YYYY-MM-DD&tanggal_sampai=YYYY-MM-DD
 *       -> { status, tanggal_dari, tanggal_sampai, buku_periode:{...},
 *            data:[ {kode_akun,nama_akun,karakter_akun,katagori_akun,tipe_akun,
 *                    depth,saldo_awal,debit,kredit,saldo_akhir} ] }
 *
 *   Header (opsional): api-key | x-api-key | api_key
 */

const express = require('express');
const { KOPERASI, MASTER_DATA_API_KEY, buildInformasi } = require('./src/koperasi');
const {
  snapshot,
  balanceSummary,
  FIRST_YEAR,
  LAST_YEAR,
} = require('./src/generator');
const {
  buildSimpanan,
  buildPinjaman,
  findProduk,
  simulasiSimpanan,
  simulasiPinjaman,
} = require('./src/products');

const app = express();
const PORT = parseInt(process.env.PORT || '4000', 10);
// Validasi api-key AKTIF secara default (set REQUIRE_API_KEY=false untuk mematikan).
const REQUIRE_API_KEY = String(process.env.REQUIRE_API_KEY ?? 'true').toLowerCase() === 'true';

app.disable('x-powered-by');
app.set('trust proxy', true); // di belakang Nginx: pakai X-Forwarded-Proto/For (req.protocol jadi https)
app.use(express.urlencoded({ extended: true })); // simulasi dikirim sebagai form (asForm())
app.use(express.json());

// Logging ringkas tiap request — memudahkan melihat panggilan dari SIMKOPDA.
app.use((req, _res, next) => {
  const key = req.get('api-key') || req.get('x-api-key') || req.get('api_key') || '-';
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} | api-key: ${key}`);
  next();
});

/** Ambil nilai header api-key (mendukung 3 varian: api-key | x-api-key | api_key). */
function reqApiKey(req) {
  return req.get('api-key') || req.get('x-api-key') || req.get('api_key') || '';
}

/** Identifikasi koperasi: path param -> query -> header key akuntansi -> default KOP01. */
function resolveKoperasi(req) {
  let kode = String(req.params.koperasi || req.query.koperasi || '').toUpperCase();
  if (!kode) {
    // Hanya key AKUNTANSI yang unik per-koperasi; master-data key bersama
    // (tidak mengidentifikasi koperasi) -> jatuh ke default KOP01.
    const key = reqApiKey(req);
    const found = Object.values(KOPERASI).find((k) => k.apiKey === key);
    if (found) kode = found.kode;
  }
  if (!kode) kode = 'KOP01';
  return KOPERASI[kode] ? kode : null;
}

/** Ambil tahun dari tanggal_dari (atau tanggal_sampai), fallback tahun terakhir. */
function yearFromQuery(req) {
  const d = req.query.tanggal_dari || req.query.tanggal_sampai;
  const y = d ? parseInt(String(d).slice(0, 4), 10) : NaN;
  return Number.isFinite(y) ? y : LAST_YEAR;
}

/** Validasi key MASTER DATA (informasi/simpanan/pinjaman/simulasi). */
function masterKeyOk(req) {
  if (!REQUIRE_API_KEY) return true;
  return reqApiKey(req) === MASTER_DATA_API_KEY;
}

/** Validasi key AKUNTANSI (neraca lajur) milik koperasi tertentu. */
function akuntansiKeyOk(req, kopKode) {
  if (!REQUIRE_API_KEY) return true;
  return reqApiKey(req) === KOPERASI[kopKode].apiKey;
}

function buildResponse(kopKode, reqYear, req) {
  // Tahun buku "tersedia" dibatasi FIRST_YEAR..LAST_YEAR. Data dikembalikan
  // untuk tahun yang diminta (lewat tanggal_dari/sampai). Tahun di luar rentang
  // di-clamp ke terdekat -> SIMKOPDA akan mendeteksi out-of-range karena
  // buku_periode.tahun_periode beda dari tahun yang diminta.
  const bukuYear = Math.max(FIRST_YEAR, Math.min(LAST_YEAR, reqYear));
  const rows = snapshot(kopKode, bukuYear);
  const tglDari = req.query.tanggal_dari || `${bukuYear}-01-01`;
  const tglSampai = req.query.tanggal_sampai || `${bukuYear}-12-31`;

  return {
    status: 'success',
    tanggal_dari: tglDari,
    tanggal_sampai: tglSampai,
    buku_periode: {
      id: bukuYear - FIRST_YEAR + 1,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      tahun_periode: bukuYear,
      is_aktif: bukuYear === LAST_YEAR ? 1 : 0,
      bulan_awal_periode: 1,
      bulan_saldo_awal: 1,
      lama_periode_bulan: 12,
      tanggal_tutup_buku: null,
      is_archived: 0,
    },
    data: rows,
  };
}

/** Handler utama endpoint neraca lajur. */
function neracaLajurHandler(req, res) {
  const kode = resolveKoperasi(req);
  if (!kode) {
    return res.status(404).json({
      status: 'error',
      message: `Koperasi tidak dikenal. Gunakan salah satu: ${Object.keys(KOPERASI).join(', ')}`,
      data: [],
    });
  }
  if (!akuntansiKeyOk(req, kode)) {
    return res.status(401).json({ status: 'error', message: 'api-key akuntansi tidak valid untuk koperasi ini.', data: [] });
  }
  return res.json(buildResponse(kode, yearFromQuery(req), req));
}

// ── Endpoint neraca lajur ───────────────────────────────────────────────────
// 1) Per-koperasi lewat path (DIREKOMENDASIKAN untuk 5 URL berbeda di SIMKOPDA).
app.get('/api/:koperasi/v1/without-auth/jurnal-umum/neraca-lajur', neracaLajurHandler);
// 2) Path kanonik (sama persis dengan API asli). Koperasi via ?koperasi= atau api-key.
app.get('/v1/without-auth/jurnal-umum/neraca-lajur', neracaLajurHandler);

// ── Produk & layanan (simpanan / pinjaman) per koperasi ─────────────────────

/** Daftar produk (kind = 'simpanan' | 'pinjaman'). */
function daftarProdukHandler(kind) {
  return (req, res) => {
    const kode = resolveKoperasi(req);
    if (!kode) {
      return res.status(404).json({ message: `Koperasi tidak dikenal. Gunakan: ${Object.keys(KOPERASI).join(', ')}`, data: [], auth: null });
    }
    if (!masterKeyOk(req)) {
      return res.status(401).json({ message: 'api-key master data tidak valid.', data: [], auth: null });
    }

    let data = kind === 'pinjaman' ? buildPinjaman(kode) : buildSimpanan(kode);

    // Filter opsional (sama seperti param yang dikirim SIMKOPDA: skema/nama/kode/buka).
    const { skema, nama, kode: kodeQ, buka } = req.query;
    if (skema) data = data.filter((p) => p.skema === String(skema));
    if (nama) data = data.filter((p) => p.nama.toLowerCase().includes(String(nama).toLowerCase()));
    if (kodeQ) data = data.filter((p) => p.kode.toLowerCase().includes(String(kodeQ).toLowerCase()));
    if (buka === '1' || buka === 'true') data = data.filter((p) => p.buka === 1);
    if (buka === '0' || buka === 'false') data = data.filter((p) => p.buka === 0);

    res.json({ message: `Berhasil memperoleh data ${kind}.`, data, auth: null });
  };
}

/** Simulasi produk (kind = 'simpanan' | 'pinjaman'). POST nominal + durasi. */
function simulasiHandler(kind) {
  return (req, res) => {
    const kode = resolveKoperasi(req);
    if (!kode) {
      return res.status(404).json({ message: 'Koperasi tidak dikenal.', data: [], auth: null });
    }
    if (!masterKeyOk(req)) {
      return res.status(401).json({ message: 'api-key master data tidak valid.', data: [], auth: null });
    }

    const produk = findProduk(kode, kind, req.params.id);
    if (!produk) {
      return res.status(404).json({ message: `Produk ${kind} id ${req.params.id} tidak ditemukan pada ${kode}.`, data: [], auth: null });
    }

    const nominal = parseFloat(req.body.nominal ?? req.query.nominal ?? 0);
    const durasi = parseInt(req.body.durasi ?? req.query.durasi ?? 0, 10);
    if (!nominal || !durasi) {
      return res.status(422).json({ message: 'Parameter "nominal" dan "durasi" wajib diisi.', data: [], auth: null });
    }

    const data = kind === 'pinjaman'
      ? simulasiPinjaman(produk, nominal, durasi)
      : simulasiSimpanan(produk, nominal, durasi);
    res.json({ message: 'Simulasi berhasil.', data, auth: null });
  };
}

// Daftar produk — slug SIMKOPDA: 'simpanan' & 'pinjaman'.
app.get('/api/:koperasi/v1/without-auth/simpanan', daftarProdukHandler('simpanan'));
app.get('/v1/without-auth/simpanan', daftarProdukHandler('simpanan'));
app.get('/api/:koperasi/v1/without-auth/pinjaman', daftarProdukHandler('pinjaman'));
app.get('/v1/without-auth/pinjaman', daftarProdukHandler('pinjaman'));

// Simulasi — slug SIMKOPDA: 'simpanan_simulasi' & 'pinjaman_simulasi' (placeholder {id}).
app.post('/api/:koperasi/v1/without-auth/simpanan/:id/simulasi', simulasiHandler('simpanan'));
app.post('/v1/without-auth/simpanan/:id/simulasi', simulasiHandler('simpanan'));
app.post('/api/:koperasi/v1/without-auth/pinjaman/:id/simulasi', simulasiHandler('pinjaman'));
app.post('/v1/without-auth/pinjaman/:id/simulasi', simulasiHandler('pinjaman'));

// ── Informasi koperasi ──────────────────────────────────────────────────────
// Slug SIMKOPDA: 'informasi_koperasi' (kategori global). Dibaca oleh
// KoperasiApiService::getInformasiKoperasi(). Path kanonik default koperasi via
// ?koperasi= / api-key (KOP01); path per-koperasi memilih lewat path param.
function informasiKoperasiHandler(req, res) {
  const kode = resolveKoperasi(req);
  if (!kode) {
    return res.status(404).json({
      message: `Koperasi tidak dikenal. Gunakan: ${Object.keys(KOPERASI).join(', ')}`,
      data: null,
      auth: null,
    });
  }
  if (!masterKeyOk(req)) {
    return res.status(401).json({ message: 'api-key master data tidak valid.', data: null, auth: null });
  }
  return res.json(buildInformasi(kode));
}

app.get('/api/:koperasi/v1/without-auth/informasi-koperasi', informasiKoperasiHandler);
app.get('/v1/without-auth/informasi-koperasi', informasiKoperasiHandler);

// ── Endpoint debug: cek neraca balance ──────────────────────────────────────
app.get('/api/:koperasi/debug/balance', (req, res) => {
  const kode = resolveKoperasi(req);
  if (!kode) return res.status(404).json({ success: false, message: 'Koperasi tidak dikenal.' });
  const year = Math.max(FIRST_YEAR, Math.min(LAST_YEAR, yearFromQuery(req)));
  res.json({ koperasi: kode, tahun: year, ...balanceSummary(kode, year) });
});

// ── Halaman info ────────────────────────────────────────────────────────────
app.get(['/', '/health'], (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({
    service: 'koperasi-mock-api',
    status: 'ok',
    deskripsi: 'Mock API neraca lajur koperasi untuk pengujian integrasi SIMKOPDA.',
    tahun_tersedia: `${FIRST_YEAR}-${LAST_YEAR}`,
    require_api_key: REQUIRE_API_KEY,
    api_key: {
      cara_kirim: 'Header: api-key (atau x-api-key / api_key)',
      master_data_api_key: MASTER_DATA_API_KEY,
      master_data_untuk: ['informasi_koperasi', 'simpanan', 'pinjaman', 'simpanan_simulasi', 'pinjaman_simulasi'],
      akuntansi_api_key_untuk: ['neraca_lajur'],
      catatan: 'Key akuntansi (neraca) berbeda per koperasi — lihat "api_key_akuntansi" di tiap koperasi.',
    },
    endpoint_pola: `${base}/api/{KODE_KOPERASI}/v1/without-auth/jurnal-umum/neraca-lajur?tanggal_dari=YYYY-01-01&tanggal_sampai=YYYY-12-31`,
    endpoint_slug_simkopda: {
      informasi_koperasi: `${base}/api/{KODE}/v1/without-auth/informasi-koperasi`,
      neraca_lajur: `${base}/api/{KODE}/v1/without-auth/jurnal-umum/neraca-lajur`,
      simpanan: `${base}/api/{KODE}/v1/without-auth/simpanan`,
      pinjaman: `${base}/api/{KODE}/v1/without-auth/pinjaman`,
      simpanan_simulasi: `${base}/api/{KODE}/v1/without-auth/simpanan/{id}/simulasi`,
      pinjaman_simulasi: `${base}/api/{KODE}/v1/without-auth/pinjaman/{id}/simulasi`,
    },
    koperasi: Object.values(KOPERASI).map((k) => ({
      kode: k.kode,
      nama: k.nama,
      id: k.informasi.id,
      alamat: k.informasi.alamat,
      api_key_akuntansi: k.apiKey,
      informasi_koperasi: `${base}/api/${k.kode}/v1/without-auth/informasi-koperasi`,
      neraca_lajur: `${base}/api/${k.kode}/v1/without-auth/jurnal-umum/neraca-lajur?tanggal_dari=2024-01-01&tanggal_sampai=2024-12-31`,
      produk_simpanan: `${base}/api/${k.kode}/v1/without-auth/simpanan`,
      produk_pinjaman: `${base}/api/${k.kode}/v1/without-auth/pinjaman`,
      cek_balance: `${base}/api/${k.kode}/debug/balance?tanggal_dari=2024-01-01`,
    })),
  });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Rute tidak ditemukan: ${req.method} ${req.originalUrl}` });
});

app.listen(PORT, () => {
  console.log(`\nKoperasi MOCK API berjalan di http://localhost:${PORT}`);
  console.log(`Tahun buku tersedia : ${FIRST_YEAR}-${LAST_YEAR}`);
  console.log(`Require api-key      : ${REQUIRE_API_KEY}`);
  console.log(`Master data api-key  : ${MASTER_DATA_API_KEY}`);
  console.log(`Koperasi             : ${Object.keys(KOPERASI).join(', ')}`);
  console.log(`Buka http://localhost:${PORT}/ untuk daftar URL.\n`);
});
