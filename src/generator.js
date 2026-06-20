'use strict';

const { ACCOUNTS } = require('./accounts');
const { KOPERASI } = require('./koperasi');
const { jitter } = require('./rng');

/**
 * Generator neraca lajur (trial balance) deterministik & balance, meniru
 * respons server akuntansi koperasi asli.
 *
 * Aturan angka:
 *   - Akun HEADER (tipe_akun=1)  : saldo_awal/debit/kredit/saldo_akhir = 0
 *     (server asli tidak me-roll-up induk).
 *   - Akun DETAIL (tipe_akun=2)  : diisi angka random-deterministik.
 *
 * Jaminan:
 *   1. BALANCE  : total aset (neto) = total kewajiban + modal, EXACT, dengan
 *                 akun Kas sebagai penyeimbang (plug).
 *   2. KONSISTEN: saldo_akhir = saldo_awal +/- (debit - kredit) sesuai sisi normal.
 *   3. KONTINU  : saldo_awal tahun Y = saldo_akhir tahun (Y-1) untuk akun permanen.
 *   4. SHU NYAMBUNG: 331 (SHU tahun berjalan) = pendapatan - beban; 515
 *                 (penyusutan) = pertambahan akumulasi penyusutan.
 *
 * Periode sub-tahunan (triwulan / semester):
 *   snapshot(kop, year, { f0, f1 }) menarik neraca lajur YEAR-TO-DATE pada
 *   jendela [f0, f1] dari tahun buku (f = fraksi hari yang sudah berjalan, 0..1):
 *     - akun PERMANEN  : saldo di-interpolasi linear antara tutup-buku tahun
 *                        (Y-1) [f=0] dan tutup-buku tahun Y [f=1]; Kas tetap
 *                        penyeimbang sehingga BALANCE di fraksi berapa pun.
 *     - akun NOMINAL   : terakumulasi proporsional -> saldo = f * jumlah setahun.
 *   Triwulan I (…-03-31) ≈ f1=0.25, Semester I (…-06-30) ≈ 0.5, Tahunan = 1.
 *   Tanpa opsi (atau f0=0,f1=1) hasilnya IDENTIK dengan neraca setahun penuh.
 */

const FIRST_YEAR = 2020;   // tahun buku pertama yang "tersedia"
const LAST_YEAR = 2026;    // tahun buku terakhir yang "tersedia"
const GENESIS_YEAR = 2019; // saldo awal untuk 2020 diambil dari sini (basis)

// Fraksi closing balance akun permanen (detail) terhadap skala S (≈ total aset).
const BAL_FRAC = {
  '113010000': 0.62,                                  // piutang anggota (aset utama)
  '121000000': 0.10, '122000000': 0.04, '123000000': 0.04, // aset tetap bruto = 0.18 S
  '211010000': 0.22, '211020000': 0.18,               // simpanan likuid
  '212000000': 0.02, '221000000': 0.10,               // utang pajak + utang bank
  '311000000': 0.04, '312000000': 0.16,               // simpanan pokok + wajib
  '321000000': 0.05, '322000000': 0.02,               // cadangan
};

const PENYISIHAN_RATE = 0.035; // 113020000 = 3.5% dari piutang anggota
const AKUM_GENESIS_FRAC = 0.05; // akum penyusutan basis (genesis) thd S
const DEPR_RATE = 0.10;         // penyusutan tahunan thd aset tetap bruto

// Fraksi akun nominal (laba-rugi, detail) terhadap S. 515 dihitung terpisah.
const PL_FRAC = {
  '411000000': 0.125, '412000000': 0.012, '413000000': 0.010, // pendapatan operasional
  '421000000': 0.006, '422000000': 0.003,                     // pendapatan non-operasional
  '511000000': 0.050, '512000000': 0.025, '513000000': 0.006, // biaya operasional
  '514000000': 0.008, '521000000': 0.004, '522000000': 0.003, // biaya operasional & non-op
};

// Faktor perputaran bruto per-periode (memunculkan debit & kredit gross,
// penting bagi Laporan Arus Kas). Akun di luar daftar ini memakai mutasi neto.
const CHURN_BASE = {
  pinjaman: 0.50,         // 113010000 : pencairan (debit) & pelunasan (kredit)
  simpanan_likuid: 0.40,  // 211010000/211020000 : setoran (kredit) & tarik (debit)
  utang: 0.30,            // 221000000 : tarik utang (kredit) & bayar (debit)
};

const round1000 = (x) => Math.round(x / 1000) * 1000;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// ── Periode sub-tahunan: konversi tanggal -> fraksi tahun (0..1) ─────────────
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInYear = (y) => (isLeap(y) ? 366 : 365);

/** Nomor hari ke-N dalam tahun (1 Jan = 1). */
function dayOfYear(y, m, d) {
  let n = d;
  for (let i = 0; i < m - 1; i++) n += DAYS_IN_MONTH[i];
  if (m > 2 && isLeap(y)) n += 1;
  return n;
}

/** Parse 'YYYY-MM-DD' -> {y,m,d} | null. */
function parseDate(s) {
  if (!s) return null;
  const mt = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(s));
  if (!mt) return null;
  const y = +mt[1], m = +mt[2], d = +mt[3];
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/**
 * Konversi (tanggal_dari, tanggal_sampai) -> jendela fraksi {f0, f1} pada
 * tahun buku. Tanggal di luar tahun buku diabaikan (default f0=0 / f1=1) supaya
 * permintaan setahun penuh tetap menghasilkan angka identik.
 */
function fractionsFromDates(bukuYear, dari, sampai) {
  const pd = parseDate(dari);
  const ps = parseDate(sampai);
  let f0 = 0;
  let f1 = 1;
  if (pd && pd.y === bukuYear) {
    f0 = clamp01((dayOfYear(pd.y, pd.m, pd.d) - 1) / daysInYear(bukuYear));
  }
  if (ps && ps.y === bukuYear) {
    f1 = clamp01(dayOfYear(ps.y, ps.m, ps.d) / daysInYear(bukuYear));
  }
  if (f1 < f0) f1 = f0; // jaga-jaga: rentang terbalik
  return { f0, f1 };
}

/** Skala (≈ total aset) untuk koperasi & tahun tertentu. */
function scale(kop, year) {
  const p = KOPERASI[kop];
  const g = jitter(`${kop}|${year}|scale`, 0.02); // +/- 2%
  return p.base * Math.pow(1 + p.growth, year - FIRST_YEAR) * (1 + g);
}

/** Aset tetap bruto per akun. */
function grossAsetTetap(kop, year) {
  const S = scale(kop, year);
  return {
    '121000000': round1000(BAL_FRAC['121000000'] * S * (1 + jitter(`${kop}|${year}|121`, 0.05))),
    '122000000': round1000(BAL_FRAC['122000000'] * S * (1 + jitter(`${kop}|${year}|122`, 0.05))),
    '123000000': round1000(BAL_FRAC['123000000'] * S * (1 + jitter(`${kop}|${year}|123`, 0.05))),
  };
}

/** Akumulasi penyusutan — roll-forward agar 515 = pertambahan akumulasi. */
function akumPenyusutan(kop, year) {
  if (year <= GENESIS_YEAR) {
    return round1000(AKUM_GENESIS_FRAC * scale(kop, year));
  }
  const prev = akumPenyusutan(kop, year - 1);
  const gross = grossAsetTetap(kop, year);
  const grossTotal = gross['121000000'] + gross['122000000'] + gross['123000000'];
  const dep = round1000(DEPR_RATE * grossTotal);
  const cap = round1000(0.85 * grossTotal); // tidak boleh menyusut > 85% nilai bruto
  return Math.min(prev + dep, cap);
}

/** Beban penyusutan tahun berjalan = pertambahan akumulasi penyusutan. */
function depresiasiTahun(kop, year) {
  return Math.max(0, akumPenyusutan(kop, year) - akumPenyusutan(kop, year - 1));
}

/** Laporan laba-rugi (akun nominal) untuk satu periode. */
function incomeStatement(kop, year) {
  const S = scale(kop, year);
  const amt = {};
  for (const kode of Object.keys(PL_FRAC)) {
    amt[kode] = round1000(PL_FRAC[kode] * S * (1 + jitter(`${kop}|${year}|${kode}`, 0.06)));
  }
  amt['515000000'] = depresiasiTahun(kop, year);

  const pendapatan = ['411000000', '412000000', '413000000', '421000000', '422000000']
    .reduce((s, k) => s + amt[k], 0);
  const beban = ['511000000', '512000000', '513000000', '514000000', '515000000', '521000000', '522000000']
    .reduce((s, k) => s + amt[k], 0);

  return { amt, pendapatan, beban, shu: pendapatan - beban };
}

/**
 * Peta saldo_akhir akun permanen (detail) untuk satu periode. Kas adalah
 * penyeimbang sehingga neraca selalu balance.
 */
function closingMap(kop, year) {
  const S = scale(kop, year);
  const m = {};

  for (const kode of [
    '113010000', '121000000', '122000000', '123000000',
    '211010000', '211020000', '212000000', '221000000',
    '311000000', '312000000', '321000000', '322000000',
  ]) {
    m[kode] = round1000(BAL_FRAC[kode] * S * (1 + jitter(`${kop}|${year}|${kode}`, 0.05)));
  }

  m['113020000'] = round1000(PENYISIHAN_RATE * m['113010000']); // kontra-aset (saldo kredit +)
  m['124000000'] = akumPenyusutan(kop, year);                   // kontra-aset
  m['331000000'] = incomeStatement(kop, year).shu;              // SHU tahun berjalan
  m['332000000'] = 0;                                           // SHU tahun lalu (diasumsikan tuntas)

  const kewajibanModal = [
    '211010000', '211020000', '212000000', '221000000',
    '311000000', '312000000', '321000000', '322000000', '331000000', '332000000',
  ].reduce((s, k) => s + m[k], 0);

  const asetNonKas =
    (m['113010000'] - m['113020000']) +
    (m['121000000'] + m['122000000'] + m['123000000'] - m['124000000']);

  // Kas total = penyeimbang. Dengan fraksi di atas nilainya selalu positif.
  const kasTotal = kewajibanModal - asetNonKas;
  const kas1 = round1000(0.45 * kasTotal);
  const kas2 = round1000(0.45 * kasTotal);
  m['111010000'] = kas1;                   // Kas Teller
  m['111020000'] = kas2;                   // Kas Kecil
  m['112010000'] = kasTotal - kas1 - kas2; // Bank Operasional -> balance tetap exact

  return m;
}

// Akun permanen non-kas (kas adalah penyeimbang, dihitung terpisah).
const PERMANEN_NONKAS = [
  '113010000', '113020000', '121000000', '122000000', '123000000', '124000000',
  '211010000', '211020000', '212000000', '221000000',
  '311000000', '312000000', '321000000', '322000000', '331000000', '332000000',
];
const KEWAJIBAN_MODAL = [
  '211010000', '211020000', '212000000', '221000000',
  '311000000', '312000000', '321000000', '322000000', '331000000', '332000000',
];

/**
 * Saldo akun permanen pada fraksi tahun f (0..1): interpolasi linear antara
 * tutup-buku (year-1) [f=0] dan tutup-buku (year) [f=1]. Kas di-plug ulang
 * sehingga BALANCE tetap exact di fraksi berapa pun (interpolasi dua keadaan
 * balance pasti balance). f<=0/f>=1 dikembalikan persis closingMap agar
 * neraca setahun penuh identik dengan versi lama.
 */
function balanceAtFraction(kop, year, f) {
  if (f <= 0) return closingMap(kop, year - 1);
  if (f >= 1) return closingMap(kop, year);

  const O = closingMap(kop, year - 1);
  const C = closingMap(kop, year);
  const m = {};
  for (const kode of PERMANEN_NONKAS) {
    m[kode] = round1000(O[kode] + f * (C[kode] - O[kode]));
  }

  const kewajibanModal = KEWAJIBAN_MODAL.reduce((s, k) => s + m[k], 0);
  const asetNonKas =
    (m['113010000'] - m['113020000']) +
    (m['121000000'] + m['122000000'] + m['123000000'] - m['124000000']);

  const kasTotal = kewajibanModal - asetNonKas; // penyeimbang -> balance exact
  const kas1 = round1000(0.45 * kasTotal);
  const kas2 = round1000(0.45 * kasTotal);
  m['111010000'] = kas1;
  m['111020000'] = kas2;
  m['112010000'] = kasTotal - kas1 - kas2;
  return m;
}

/**
 * Hitung kolom debit/kredit dari mutasi (closing - opening) sesuai sisi normal.
 * churnScale (0..1) menyusutkan perputaran bruto sesuai panjang jendela periode
 * (mis. triwulan -> ~0.25); default 1 = setahun penuh.
 */
function mutationColumns(acc, open, close, churnScale = 1) {
  const net = close - open; // selisih pada sisi normal akun
  const churn = CHURN_BASE[acc.role];

  if (churn !== undefined && open > 0) {
    const base = round1000(churn * open * churnScale);
    if (acc.karakter === 'D') {
      // pencairan (debit) & pelunasan (kredit)
      return net >= 0
        ? { debit: base + net, kredit: base }
        : { debit: base, kredit: base - net };
    }
    // setoran (kredit) & penarikan (debit)
    return net >= 0
      ? { kredit: base + net, debit: base }
      : { kredit: base, debit: base - net };
  }

  // perputaran rendah -> satu kolom mutasi neto
  if (acc.karakter === 'D') {
    return net >= 0 ? { debit: net, kredit: 0 } : { debit: 0, kredit: -net };
  }
  return net >= 0 ? { kredit: net, debit: 0 } : { kredit: 0, debit: -net };
}

/**
 * Bangun seluruh baris neraca lajur (header + detail) untuk satu koperasi & tahun.
 * Bentuk baris identik dengan API asli:
 *   { kode_akun, nama_akun, karakter_akun, katagori_akun, tipe_akun, depth,
 *     saldo_awal, debit, kredit, saldo_akhir }
 */
function snapshot(kop, year, opts = {}) {
  const f0 = clamp01(opts.f0 ?? 0);
  const f1 = clamp01(opts.f1 ?? 1);
  const span = Math.max(0, f1 - f0); // panjang jendela periode (skala perputaran)

  const openP = balanceAtFraction(kop, year, f0); // saldo awal jendela
  const closeP = balanceAtFraction(kop, year, f1); // saldo akhir jendela (cut-off)
  const is = incomeStatement(kop, year);
  const rows = [];

  for (const acc of ACCOUNTS) {
    let saldo_awal = 0;
    let debit = 0;
    let kredit = 0;
    let saldo_akhir = 0;

    if (acc.tipe === 2) {
      if (acc.katagori === 4 || acc.katagori === 5) {
        // Akun nominal (pendapatan/biaya) = laporan ALIRAN: nilainya mencerminkan
        // aktivitas SELAMA window periode [f0, f1], bukan year-to-date. Dengan
        // begitu tiap periode benar-benar distinct: Semester 2 (Jul–Des) ≠ Tahunan,
        // Triwulan 2 (Apr–Jun) ≠ Semester 1 (Jan–Jun), dst. Akun nominal selalu
        // mulai 0 tiap periode (saldo_awal = 0). Untuk permintaan setahun penuh
        // (f0=0,f1=1) hasilnya tetap = jumlah setahun seperti sebelumnya.
        const amount = is.amt[acc.kode] || 0;
        const flow = round1000(span * amount); // span = f1 - f0 (panjang window)
        saldo_awal = 0;
        saldo_akhir = flow;
        if (acc.karakter === 'K') { kredit = flow; } else { debit = flow; }
      } else {
        // Akun permanen (aktiva/kewajiban/modal).
        saldo_awal = openP[acc.kode] || 0;
        saldo_akhir = closeP[acc.kode] || 0;
        const cols = mutationColumns(acc, saldo_awal, saldo_akhir, span);
        debit = cols.debit;
        kredit = cols.kredit;
      }
    }
    // Akun header (tipe 1): tetap 0 (tidak di-roll up), sesuai server asli.

    rows.push({
      kode_akun: acc.kode,
      nama_akun: acc.nama,
      karakter_akun: acc.karakter,
      katagori_akun: acc.katagori,
      tipe_akun: acc.tipe,
      depth: acc.depth,
      saldo_awal,
      debit,
      kredit,
      saldo_akhir,
    });
  }

  return rows;
}

/** Ringkasan untuk verifikasi (dipakai endpoint /debug & script check). */
function balanceSummary(kop, year, opts = {}) {
  const f0 = clamp01(opts.f0 ?? 0);
  const f1 = clamp01(opts.f1 ?? 1);
  const rows = snapshot(kop, year, { f0, f1 });
  const by = Object.fromEntries(rows.map((r) => [r.kode_akun, r]));
  const sa = (k) => by[k].saldo_akhir;

  const totalAset =
    sa('111010000') + sa('111020000') + sa('112010000') +
    (sa('113010000') - sa('113020000')) +
    (sa('121000000') + sa('122000000') + sa('123000000') - sa('124000000'));

  const totalKewajiban = sa('211010000') + sa('211020000') + sa('212000000') + sa('221000000');
  const totalModal =
    sa('311000000') + sa('312000000') + sa('321000000') + sa('322000000') + sa('331000000') + sa('332000000');

  // Laba-rugi kumulatif sampai cut-off (saldo_akhir akun nominal).
  const pendapatan = rows.filter((r) => r.katagori_akun === 4 && r.tipe_akun === 2)
    .reduce((s, r) => s + r.saldo_akhir, 0);
  const beban = rows.filter((r) => r.katagori_akun === 5 && r.tipe_akun === 2)
    .reduce((s, r) => s + r.saldo_akhir, 0);

  return {
    total_aset: totalAset,
    total_kewajiban: totalKewajiban,
    total_modal: totalModal,
    total_pasiva: totalKewajiban + totalModal,
    selisih: totalAset - (totalKewajiban + totalModal),
    balance: totalAset === totalKewajiban + totalModal,
    pendapatan,
    beban,
    shu: pendapatan - beban,          // SHU laba-rugi (year-to-date)
    shu_neraca: sa('331000000'),      // SHU pada neraca (akun 331, interpolasi)
    f0,
    f1,
  };
}

module.exports = {
  FIRST_YEAR,
  LAST_YEAR,
  GENESIS_YEAR,
  snapshot,
  closingMap,
  incomeStatement,
  balanceSummary,
  fractionsFromDates,
};
