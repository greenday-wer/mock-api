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

/** Hitung kolom debit/kredit dari mutasi (closing - opening) sesuai sisi normal. */
function mutationColumns(acc, open, close) {
  const net = close - open; // selisih pada sisi normal akun
  const churn = CHURN_BASE[acc.role];

  if (churn !== undefined && open > 0) {
    const base = round1000(churn * open);
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
function snapshot(kop, year) {
  const closeP = closingMap(kop, year);
  const openP = closingMap(kop, year - 1);
  const is = incomeStatement(kop, year);
  const rows = [];

  for (const acc of ACCOUNTS) {
    let saldo_awal = 0;
    let debit = 0;
    let kredit = 0;
    let saldo_akhir = 0;

    if (acc.tipe === 2) {
      if (acc.katagori === 4 || acc.katagori === 5) {
        // Akun nominal (pendapatan/biaya): di-reset tiap periode.
        const amount = is.amt[acc.kode] || 0;
        saldo_awal = 0;
        saldo_akhir = amount;
        if (acc.karakter === 'K') { kredit = amount; } else { debit = amount; }
      } else {
        // Akun permanen (aktiva/kewajiban/modal).
        saldo_awal = openP[acc.kode] || 0;
        saldo_akhir = closeP[acc.kode] || 0;
        const cols = mutationColumns(acc, saldo_awal, saldo_akhir);
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
function balanceSummary(kop, year) {
  const rows = snapshot(kop, year);
  const by = Object.fromEntries(rows.map((r) => [r.kode_akun, r]));
  const sa = (k) => by[k].saldo_akhir;

  const totalAset =
    sa('111010000') + sa('111020000') + sa('112010000') +
    (sa('113010000') - sa('113020000')) +
    (sa('121000000') + sa('122000000') + sa('123000000') - sa('124000000'));

  const totalKewajiban = sa('211010000') + sa('211020000') + sa('212000000') + sa('221000000');
  const totalModal =
    sa('311000000') + sa('312000000') + sa('321000000') + sa('322000000') + sa('331000000') + sa('332000000');

  const is = incomeStatement(kop, year);
  return {
    total_aset: totalAset,
    total_kewajiban: totalKewajiban,
    total_modal: totalModal,
    total_pasiva: totalKewajiban + totalModal,
    selisih: totalAset - (totalKewajiban + totalModal),
    balance: totalAset === totalKewajiban + totalModal,
    pendapatan: is.pendapatan,
    beban: is.beban,
    shu: is.shu,
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
};
