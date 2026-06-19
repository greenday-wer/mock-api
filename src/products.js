'use strict';

const { KOPERASI } = require('./koperasi');
const { rand, jitter } = require('./rng');

/**
 * Produk & layanan per koperasi (simpanan & pinjaman) + simulasi.
 *
 * Bentuk item dibuat PERSIS seperti respons API asli
 *   GET /v1/without-auth/simpanan  (dan /pinjaman)
 * yang dibaca SIMKOPDA (PortalController):
 *   id, nama, kode, skema, buka(int), deskripsi,
 *   detail: { kunci, akuntansi:{akun_id,kode_akun}, jangka, bunga:{...,
 *             suku_bunga:[{berlaku_dari,berlaku_sampai,tingkat:[{jumlah,
 *             nominal_dari,nominal_sampai}]}]}, setor, tarik, biaya, lengkap },
 *   created_at, updated_at, jenis_simpanan:{id,nama}, organisasi
 *
 * Path yang dibaca SIMKOPDA tetap dijaga:
 *   detail.bunga.suku_bunga[0].tingkat[].jumlah
 *   detail.setor.setoran_awal.jumlah  (fallback detail.setor.nominal.jumlah)
 *   detail.tarik.saldo_minimal
 *   detail.biaya.administrasi.nominal
 *   jenis_simpanan.nama
 *
 * Deterministik: produk & angka sama setiap kali dipanggil.
 */

const round1000 = (x) => Math.round(x / 1000) * 1000;
const money = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2); // 5000 -> "5000.00"
const rateStr = (x) => String(Math.round(Number(x) * 100) / 100);    // 5.5 -> "5.5", 6 -> "6"
const kopIndex = (kode) => Object.keys(KOPERASI).indexOf(kode) + 1;

// id akun akuntansi (mirror tautan ke kode_akun pada neraca lajur).
const AKUN_ID = { '211010000': 19, '211020000': 20, '113010000': 9 };

// Basis timestamp deterministik (≈ 1 Jan 2025) + offset dari seed.
const tsFor = (seed) => 1735689600 + Math.floor(rand(seed) * 30000000);

// Bracket nominal untuk tingkat bunga berjenjang.
const BRACKETS = [
  ['100000.00', '1000000.00'],
  ['1000000.01', '10000000.00'],
  ['10000000.01', '100000000.00'],
];

/** Bangun array `tingkat` (berjenjang sesuai bracket nominal). */
function buildTingkat(rates) {
  return rates.map((r, i) => ({
    jumlah: rateStr(r),
    nominal_dari: BRACKETS[i] ? BRACKETS[i][0] : BRACKETS[BRACKETS.length - 1][0],
    nominal_sampai: BRACKETS[i] ? BRACKETS[i][1] : null,
  }));
}

/** Bungkus tingkat dalam satu periode suku bunga berlaku. */
const sukuBunga = (rates) => [
  { berlaku_dari: '01-01-2025', berlaku_sampai: '31-12-2026', tingkat: buildTingkat(rates) },
];

// ── Template produk simpanan (master) ───────────────────────────────────────
const SIMPANAN_TPL = [
  {
    key: 'tabungan', nama: 'Tabungan Reguler', kodeSuffix: 'TR', skema: 'simpanan',
    flavor: 'tabungan', jenis: { id: 1, nama: 'Tabungan Reguler' }, akun: '211010000',
    rates: [1.0, 2.0], setoran_awal: 100000, saldo_minimal: 20000, biaya_admin: 5000,
  },
  {
    key: 'pendidikan', nama: 'Tabungan Pendidikan', kodeSuffix: 'TP', skema: 'simpanan',
    flavor: 'tabungan', jenis: { id: 2, nama: 'Tabungan Berencana' }, akun: '211010000',
    rates: [3.0], setoran_awal: 50000, saldo_minimal: 10000, biaya_admin: 2500,
  },
  {
    key: 'deposito', nama: 'Deposito', kodeSuffix: 'DP', skema: 'deposito',
    flavor: 'deposito', jenis: { id: 3, nama: 'Deposito' }, akun: '211020000',
    rates: [5.0, 6.0, 7.0], nominal: 1000000, durasi: 3,
  },
  {
    key: 'hariraya', nama: 'Tabungan Hari Raya', kodeSuffix: 'THR', skema: 'simpanan',
    flavor: 'tabungan', jenis: { id: 2, nama: 'Tabungan Berencana' }, akun: '211010000',
    rates: [3.5], setoran_awal: 25000, saldo_minimal: 0, biaya_admin: 0,
  },
];

// ── Template produk pinjaman (master) ───────────────────────────────────────
const PINJAMAN_TPL = [
  {
    key: 'modal', nama: 'Pinjaman Modal Usaha', kodeSuffix: 'PMU', skema: 'pinjaman',
    jenis: { id: 1, nama: 'Produktif' }, metode: 'menurun',
    rate: 14.0, plafon_min: 1000000, plafon_max: 100000000, tenor: 36, biaya_admin: 50000, provisi: 1.0,
  },
  {
    key: 'multiguna', nama: 'Pinjaman Multiguna', kodeSuffix: 'PMG', skema: 'pinjaman',
    jenis: { id: 2, nama: 'Konsumtif' }, metode: 'flat',
    rate: 18.0, plafon_min: 1000000, plafon_max: 50000000, tenor: 24, biaya_admin: 35000, provisi: 1.5,
  },
  {
    key: 'kendaraan', nama: 'Pinjaman Kendaraan', kodeSuffix: 'PKD', skema: 'pinjaman',
    jenis: { id: 2, nama: 'Konsumtif' }, metode: 'flat',
    rate: 11.0, plafon_min: 5000000, plafon_max: 200000000, tenor: 48, biaya_admin: 75000, provisi: 1.0,
  },
  {
    key: 'talangan', nama: 'Pinjaman Talangan', kodeSuffix: 'PTL', skema: 'pinjaman',
    jenis: { id: 3, nama: 'Darurat' }, metode: 'flat',
    rate: 22.0, plafon_min: 500000, plafon_max: 10000000, tenor: 12, biaya_admin: 15000, provisi: 2.0,
  },
];

/**
 * Status buka/tutup produk (deterministik). Semua koperasi menawarkan lineup
 * produk yang SAMA (nama konsisten), namun sebagian produk bisa berstatus
 * tutup (buka=0) berbeda-beda antar koperasi sebagai variasi.
 */
function bukaStatus(seed) {
  return rand(`${seed}|buka`) < 0.2 ? 0 : 1;
}

/** Bagian detail untuk produk simpanan jenis tabungan. */
function detailTabungan(t, sizeMul, rates) {
  const setoranAwal = round1000(t.setoran_awal * sizeMul);
  const saldoMin = round1000(t.saldo_minimal * sizeMul);
  return {
    kunci: true,
    akuntansi: { akun_id: AKUN_ID[t.akun], kode_akun: t.akun },
    jangka: { aktifkan_konfigurasi_jangka: false },
    bunga: {
      akumulasi_bunga: { periode: 'bulanan' },
      perhitungan_bunga: { dasar: 'saldo_rata_rata' },
      bunga_majemuk: false,
      suku_bunga: sukuBunga(rates),
    },
    setor: {
      setoran_awal: { jumlah: money(setoranAwal) },
      setoran_selanjutnya_ditentukan_saat_pembukaan_rekening: false,
      setoran_selanjutnya: { jenis: 'fleksibel' },
    },
    tarik: {
      saldo_minimal: money(saldoMin),
      saldo_minimal_tutup_rekening: money(round1000(saldoMin * 2.5 || 50000)),
    },
    biaya: {
      kena_pajak_atas_bunga: false,
      persentase_rekening_cadangan_partisipasi: '0',
      administrasi: { nominal: money(t.biaya_admin) },
      rekening: {
        pembukaan: { nominal: '0.00' },
        penutupan: { nominal: '0.00' },
        penggantian_buku: { nominal: '0.00' },
      },
    },
    lengkap: true,
  };
}

/** Bagian detail untuk produk simpanan jenis deposito. */
function detailDeposito(t, sizeMul, rates) {
  const nominal = round1000(t.nominal * sizeMul);
  return {
    kunci: true,
    akuntansi: { akun_id: AKUN_ID[t.akun], kode_akun: t.akun },
    jangka: { durasi: String(t.durasi), perpanjangan_otomatis: { status: false } },
    bunga: {
      jenis_bunga: 'fixed',
      bunga_majemuk: false,
      suku_bunga: sukuBunga(rates),
    },
    setor: { nominal: { jumlah: money(nominal) } },
    tarik: [],
    biaya: {
      kena_pajak_atas_bunga: false,
      persentase_rekening_cadangan_partisipasi: '0',
      penalti_penarikan_awal: { nominal: '0.00', persentase_pokok: '0', bebas: { status: false } },
      meterai: { nominal: '0.00' },
    },
    lengkap: true,
  };
}

/** Daftar produk simpanan untuk satu koperasi (lineup penuh & konsisten). */
function buildSimpanan(kode) {
  if (!KOPERASI[kode]) return [];
  const idx = kopIndex(kode);
  const sizeMul = 1 + (idx - 1) * 0.25; // koperasi lebih besar -> minimum lebih tinggi

  return SIMPANAN_TPL.map((t, i) => {
    const seed = `${kode}|simp|${t.key}`;
    const rates = t.rates.map((r, k) => Math.max(0.5, r + jitter(`${seed}|r${k}`, 0.5)));
    const detail = t.flavor === 'deposito'
      ? detailDeposito(t, sizeMul, rates)
      : detailTabungan(t, sizeMul, rates);

    return {
      id: idx * 100 + (i + 1), // unik per koperasi
      nama: t.nama,
      kode: t.kodeSuffix,
      skema: t.skema,
      buka: bukaStatus(seed),
      deskripsi: `${t.nama} untuk anggota ${KOPERASI[kode].nama}.`,
      detail,
      created_at: tsFor(`${seed}|c`),
      updated_at: tsFor(`${seed}|u`),
      jenis_simpanan: { id: t.jenis.id, nama: t.jenis.nama },
      organisasi: null,
    };
  });
}

/** Bagian detail untuk produk pinjaman. */
function detailPinjaman(t, sizeMul, rate) {
  const min = round1000(t.plafon_min);
  const max = round1000(t.plafon_max * sizeMul);
  return {
    kunci: true,
    akuntansi: { akun_id: AKUN_ID['113010000'], kode_akun: '113010000' },
    jangka: { tenor_maksimal_bulan: t.tenor, perpanjangan_otomatis: { status: false } },
    bunga: {
      metode: t.metode, // 'flat' | 'menurun'
      jenis_bunga: 'fixed',
      bunga_majemuk: false,
      suku_bunga: [
        {
          berlaku_dari: '01-01-2025',
          berlaku_sampai: '31-12-2026',
          tingkat: [{ jumlah: rateStr(rate), nominal_dari: money(min), nominal_sampai: money(max) }],
        },
      ],
    },
    plafon: { minimal: money(min), maksimal: money(max) },
    biaya: {
      administrasi: { nominal: money(t.biaya_admin) },
      provisi: { persentase: rateStr(t.provisi), nominal: '0.00' },
      materai: { nominal: '10000.00' },
    },
    agunan: { wajib: t.key !== 'talangan', jenis: t.key === 'kendaraan' ? 'BPKB' : 'fleksibel' },
    lengkap: true,
  };
}

/** Daftar produk pinjaman untuk satu koperasi (lineup penuh & konsisten). */
function buildPinjaman(kode) {
  if (!KOPERASI[kode]) return [];
  const idx = kopIndex(kode);
  const sizeMul = 1 + (idx - 1) * 0.5; // plafon lebih besar untuk koperasi besar

  return PINJAMAN_TPL.map((t, i) => {
    const seed = `${kode}|pinj|${t.key}`;
    const rate = Math.max(1, t.rate + jitter(seed, 1.0)); // +/- 1%

    return {
      id: idx * 100 + 50 + (i + 1), // ruang id terpisah dari simpanan
      nama: t.nama,
      kode: t.kodeSuffix,
      skema: t.skema,
      buka: bukaStatus(seed),
      deskripsi: `${t.nama} (${t.jenis.nama}) untuk anggota ${KOPERASI[kode].nama}.`,
      detail: detailPinjaman(t, sizeMul, rate),
      created_at: tsFor(`${seed}|c`),
      updated_at: tsFor(`${seed}|u`),
      jenis_pinjaman: { id: t.jenis.id, nama: t.jenis.nama },
      organisasi: null,
    };
  });
}

/** Cari satu produk berdasarkan id di dalam koperasi. */
function findProduk(kode, kind, id) {
  const list = kind === 'pinjaman' ? buildPinjaman(kode) : buildSimpanan(kode);
  return list.find((p) => String(p.id) === String(id)) || null;
}

/**
 * Pilih suku bunga sesuai NOMINAL dari struktur berjenjang.
 * Mencari `tingkat` yang `nominal_dari <= nominal <= nominal_sampai`.
 * Bila nominal di bawah bracket terendah → pakai tingkat terendah; bila di
 * atas bracket tertinggi → pakai tingkat tertinggi. `nominal_sampai` null
 * dianggap tak terbatas.
 */
function rateForNominal(produk, nominal) {
  const sb = (produk.detail && produk.detail.bunga && produk.detail.bunga.suku_bunga) || [];
  const tingkat = (sb[0] && sb[0].tingkat) || [];
  const parsed = tingkat
    .map((t) => ({
      rate: parseFloat(t.jumlah),
      dari: t.nominal_dari != null ? parseFloat(t.nominal_dari) : -Infinity,
      sampai: t.nominal_sampai != null ? parseFloat(t.nominal_sampai) : Infinity,
    }))
    .filter((t) => !Number.isNaN(t.rate))
    .sort((a, b) => a.dari - b.dari);

  if (!parsed.length) return 0;

  const hit = parsed.find((t) => nominal >= t.dari && nominal <= t.sampai);
  if (hit) return hit.rate;
  if (nominal < parsed[0].dari) return parsed[0].rate;          // di bawah minimum
  return parsed[parsed.length - 1].rate;                        // di atas maksimum
}

/** Ambil biaya administrasi per bulan dari struktur produk. */
function adminNominal(produk) {
  const a = produk.detail && produk.detail.biaya && produk.detail.biaya.administrasi;
  const n = a && a.nominal != null ? parseFloat(a.nominal) : 0;
  return Number.isNaN(n) ? 0 : n;
}

/** Simulasi simpanan (bunga sederhana, durasi dalam bulan). */
function simulasiSimpanan(produk, nominal, durasi) {
  const r = rateForNominal(produk, nominal);
  const bunga = nominal * (r / 100) * (durasi / 12);
  const biayaAdmin = adminNominal(produk);          // per bulan
  const totalBiayaAdmin = biayaAdmin * durasi;      // selama durasi
  const saldoAkhir = nominal + bunga - totalBiayaAdmin;
  return {
    jenis: 'simpanan',
    produk: produk.nama,
    kode: produk.kode,
    nominal: Math.round(nominal),
    durasi_bulan: durasi,
    suku_bunga: rateStr(r) + '%',
    metode: 'bunga sederhana',
    estimasi_bunga: Math.round(bunga),
    total_bunga: Math.round(bunga),
    biaya_admin: Math.round(biayaAdmin),             // per bulan
    total_biaya_admin: Math.round(totalBiayaAdmin),  // total selama durasi
    total_estimasi: Math.round(saldoAkhir),          // saldo akhir = setoran + bunga - biaya admin
    total_uang: Math.round(saldoAkhir),
  };
}

/**
 * Simulasi pinjaman. Menghormati metode produk:
 *  - 'menurun' (efektif): bunga dihitung dari SISA pokok → bunga & angsuran
 *    menurun tiap bulan, pokok tetap.
 *  - 'anuitas': angsuran tetap, komposisi pokok/bunga berubah.
 *  - 'flat' (default): bunga dari pokok awal → bunga & angsuran tetap.
 * Durasi dalam bulan; jadwal mencakup seluruh tenor.
 */
function simulasiPinjaman(produk, nominal, durasi) {
  const r = rateForNominal(produk, nominal);
  const metode = (produk.detail && produk.detail.bunga && produk.detail.bunga.metode) || 'flat';
  const monthlyRate = (r / 100) / 12;
  const pokokPerBulan = nominal / durasi;

  const jadwal = [];
  let sisa = nominal;
  let totalBunga = 0;

  if (metode === 'anuitas' && monthlyRate > 0) {
    // Angsuran tetap (anuitas).
    const angsuran = (nominal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -durasi));
    for (let m = 1; m <= durasi; m++) {
      const bunga = sisa * monthlyRate;
      const pokok = angsuran - bunga;
      sisa -= pokok;
      totalBunga += bunga;
      jadwal.push({
        bulan: m,
        angsuran: Math.round(angsuran),
        pokok: Math.round(pokok),
        bunga: Math.round(bunga),
        sisa_pokok: Math.max(0, Math.round(sisa)),
      });
    }
  } else if (metode === 'menurun' || metode === 'efektif') {
    // Bunga menurun: pokok tetap, bunga atas sisa pokok.
    for (let m = 1; m <= durasi; m++) {
      const bunga = sisa * monthlyRate;
      sisa -= pokokPerBulan;
      totalBunga += bunga;
      jadwal.push({
        bulan: m,
        angsuran: Math.round(pokokPerBulan + bunga),
        pokok: Math.round(pokokPerBulan),
        bunga: Math.round(bunga),
        sisa_pokok: Math.max(0, Math.round(sisa)),
      });
    }
  } else {
    // Flat: bunga tetap atas pokok awal.
    const bungaPerBulan = (nominal * (r / 100) * (durasi / 12)) / durasi;
    for (let m = 1; m <= durasi; m++) {
      sisa -= pokokPerBulan;
      totalBunga += bungaPerBulan;
      jadwal.push({
        bulan: m,
        angsuran: Math.round(pokokPerBulan + bungaPerBulan),
        pokok: Math.round(pokokPerBulan),
        bunga: Math.round(bungaPerBulan),
        sisa_pokok: Math.max(0, Math.round(sisa)),
      });
    }
  }

  return {
    jenis: 'pinjaman',
    produk: produk.nama,
    kode: produk.kode,
    plafon: Math.round(nominal),
    tenor_bulan: durasi,
    suku_bunga: rateStr(r) + '%',
    metode,
    angsuran_per_bulan: jadwal.length ? jadwal[0].angsuran : 0,
    total_bunga: Math.round(totalBunga),
    total_pembayaran: Math.round(nominal + totalBunga),
    total_uang: Math.round(nominal + totalBunga),
    jadwal,
  };
}

module.exports = {
  buildSimpanan,
  buildPinjaman,
  findProduk,
  simulasiSimpanan,
  simulasiPinjaman,
};
