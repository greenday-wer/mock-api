'use strict';

/**
 * Bagan akun (chart of accounts) HIRARKIS — meniru persis respons API asli
 * `/v1/without-auth/jurnal-umum/neraca-lajur` milik server akuntansi koperasi.
 *
 * Tiap baris memuat field yang sama dengan API asli:
 *   kode_akun      : 9 digit.
 *   nama_akun      : nama akun.
 *   karakter_akun  : 'D' (debit) | 'K' (kredit) — sisi saldo normal.
 *   katagori_akun  : 1=Aktiva, 2=Kewajiban, 3=Modal, 4=Pendapatan, 5=Biaya.
 *   tipe_akun      : 1=header (induk, saldo 0 — tidak di-roll up server-side),
 *                    2=detail/leaf (akun bersaldo, dipakai mapping SIMKOPDA).
 *   depth          : kedalaman pada pohon akun (0..3).
 *
 * `role` HANYA ada pada akun detail (tipe 2) dan dipakai generator untuk
 * menentukan perilaku angka. Akun header tidak punya role (saldo selalu 0).
 *
 * Kode leaf identik dengan yang dirujuk mapping Neraca Lajur SIMKOPDA
 * (LP/SHU/PE/AK) sehingga data bisa langsung dipetakan.
 */
const ACCOUNTS = [
  // ═══════════ 1 — AKTIVA (karakter D) ═══════════
  { kode: '100000000', nama: 'AKTIVA',                       karakter: 'D', katagori: 1, tipe: 1, depth: 0 },
  { kode: '110000000', nama: 'AKTIVA LANCAR',                karakter: 'D', katagori: 1, tipe: 1, depth: 1 },
  { kode: '111000000', nama: 'KAS',                          karakter: 'D', katagori: 1, tipe: 1, depth: 2 },
  { kode: '111010000', nama: 'Kas Teller',                   karakter: 'D', katagori: 1, tipe: 2, depth: 3, role: 'kas' },
  { kode: '111020000', nama: 'Kas Kecil',                    karakter: 'D', katagori: 1, tipe: 2, depth: 3, role: 'kas' },
  { kode: '112000000', nama: 'BANK',                         karakter: 'D', katagori: 1, tipe: 1, depth: 2 },
  { kode: '112010000', nama: 'Bank Operasional',             karakter: 'D', katagori: 1, tipe: 2, depth: 3, role: 'kas' },
  { kode: '113000000', nama: 'PIUTANG',                      karakter: 'D', katagori: 1, tipe: 1, depth: 2 },
  { kode: '113010000', nama: 'Piutang Anggota',              karakter: 'D', katagori: 1, tipe: 2, depth: 3, role: 'pinjaman' },
  { kode: '113020000', nama: 'Cadangan Piutang Ragu-Ragu',   karakter: 'K', katagori: 1, tipe: 2, depth: 3, role: 'kontra_pinjaman' },
  { kode: '120000000', nama: 'AKTIVA TETAP',                 karakter: 'D', katagori: 1, tipe: 1, depth: 1 },
  { kode: '121000000', nama: 'Tanah',                        karakter: 'D', katagori: 1, tipe: 2, depth: 2, role: 'aset_tetap' },
  { kode: '122000000', nama: 'Bangunan',                     karakter: 'D', katagori: 1, tipe: 2, depth: 2, role: 'aset_tetap' },
  { kode: '123000000', nama: 'Peralatan Kantor',             karakter: 'D', katagori: 1, tipe: 2, depth: 2, role: 'aset_tetap' },
  { kode: '124000000', nama: 'Akumulasi Penyusutan',         karakter: 'K', katagori: 1, tipe: 2, depth: 2, role: 'akum_penyusutan' },

  // ═══════════ 2 — KEWAJIBAN (karakter K) ═══════════
  { kode: '200000000', nama: 'KEWAJIBAN',                    karakter: 'K', katagori: 2, tipe: 1, depth: 0 },
  { kode: '210000000', nama: 'KEWAJIBAN LANCAR',             karakter: 'K', katagori: 2, tipe: 1, depth: 1 },
  { kode: '211000000', nama: 'SIMPANAN ANGGOTA',             karakter: 'K', katagori: 2, tipe: 1, depth: 2 },
  { kode: '211010000', nama: 'Simpanan Sukarela',           karakter: 'K', katagori: 2, tipe: 2, depth: 3, role: 'simpanan_likuid' },
  { kode: '211020000', nama: 'Simpanan Berjangka',          karakter: 'K', katagori: 2, tipe: 2, depth: 3, role: 'simpanan_likuid' },
  { kode: '212000000', nama: 'Utang Pajak',                 karakter: 'K', katagori: 2, tipe: 2, depth: 2, role: 'liabilitas' },
  { kode: '220000000', nama: 'KEWAJIBAN JANGKA PANJANG',    karakter: 'K', katagori: 2, tipe: 1, depth: 1 },
  { kode: '221000000', nama: 'Utang Bank Jangka Panjang',   karakter: 'K', katagori: 2, tipe: 2, depth: 2, role: 'utang' },

  // ═══════════ 3 — MODAL (karakter K) ═══════════
  { kode: '300000000', nama: 'MODAL',                       karakter: 'K', katagori: 3, tipe: 1, depth: 0 },
  { kode: '310000000', nama: 'SIMPANAN POKOK & WAJIB',      karakter: 'K', katagori: 3, tipe: 1, depth: 1 },
  { kode: '311000000', nama: 'Simpanan Pokok',             karakter: 'K', katagori: 3, tipe: 2, depth: 2, role: 'ekuitas' },
  { kode: '312000000', nama: 'Simpanan Wajib',             karakter: 'K', katagori: 3, tipe: 2, depth: 2, role: 'ekuitas' },
  { kode: '320000000', nama: 'CADANGAN',                   karakter: 'K', katagori: 3, tipe: 1, depth: 1 },
  { kode: '321000000', nama: 'Cadangan Umum',             karakter: 'K', katagori: 3, tipe: 2, depth: 2, role: 'ekuitas' },
  { kode: '322000000', nama: 'Cadangan Risiko',           karakter: 'K', katagori: 3, tipe: 2, depth: 2, role: 'ekuitas' },
  { kode: '330000000', nama: 'SHU',                       karakter: 'K', katagori: 3, tipe: 1, depth: 1 },
  { kode: '331000000', nama: 'SHU Tahun Berjalan',        karakter: 'K', katagori: 3, tipe: 2, depth: 2, role: 'shu_berjalan' },
  { kode: '332000000', nama: 'SHU Tahun Lalu',            karakter: 'K', katagori: 3, tipe: 2, depth: 2, role: 'shu_lalu' },

  // ═══════════ 4 — PENDAPATAN (karakter K, akun nominal) ═══════════
  { kode: '400000000', nama: 'PENDAPATAN',                karakter: 'K', katagori: 4, tipe: 1, depth: 0 },
  { kode: '410000000', nama: 'PENDAPATAN OPERASIONAL',    karakter: 'K', katagori: 4, tipe: 1, depth: 1 },
  { kode: '411000000', nama: 'Pendapatan Bunga Pinjaman', karakter: 'K', katagori: 4, tipe: 2, depth: 2, role: 'pendapatan' },
  { kode: '412000000', nama: 'Pendapatan Administrasi',   karakter: 'K', katagori: 4, tipe: 2, depth: 2, role: 'pendapatan' },
  { kode: '413000000', nama: 'Pendapatan Provisi',        karakter: 'K', katagori: 4, tipe: 2, depth: 2, role: 'pendapatan' },
  { kode: '420000000', nama: 'PENDAPATAN NON OPERASIONAL', karakter: 'K', katagori: 4, tipe: 1, depth: 1 },
  { kode: '421000000', nama: 'Pendapatan Bunga Bank',     karakter: 'K', katagori: 4, tipe: 2, depth: 2, role: 'pendapatan' },
  { kode: '422000000', nama: 'Pendapatan Lain-Lain',      karakter: 'K', katagori: 4, tipe: 2, depth: 2, role: 'pendapatan' },

  // ═══════════ 5 — BIAYA (karakter D, akun nominal) ═══════════
  { kode: '500000000', nama: 'BIAYA',                     karakter: 'D', katagori: 5, tipe: 1, depth: 0 },
  { kode: '510000000', nama: 'BIAYA OPERASIONAL',         karakter: 'D', katagori: 5, tipe: 1, depth: 1 },
  { kode: '511000000', nama: 'Biaya Bunga Simpanan',      karakter: 'D', katagori: 5, tipe: 2, depth: 2, role: 'beban' },
  { kode: '512000000', nama: 'Biaya Gaji dan Tunjangan',  karakter: 'D', katagori: 5, tipe: 2, depth: 2, role: 'beban' },
  { kode: '513000000', nama: 'Biaya ATK',                 karakter: 'D', katagori: 5, tipe: 2, depth: 2, role: 'beban' },
  { kode: '514000000', nama: 'Biaya Listrik dan Air',     karakter: 'D', katagori: 5, tipe: 2, depth: 2, role: 'beban' },
  { kode: '515000000', nama: 'Biaya Penyusutan',          karakter: 'D', katagori: 5, tipe: 2, depth: 2, role: 'beban_penyusutan' },
  { kode: '520000000', nama: 'BIAYA NON OPERASIONAL',     karakter: 'D', katagori: 5, tipe: 1, depth: 1 },
  { kode: '521000000', nama: 'Biaya Administrasi Bank',   karakter: 'D', katagori: 5, tipe: 2, depth: 2, role: 'beban' },
  { kode: '522000000', nama: 'Biaya Lain-Lain',           karakter: 'D', katagori: 5, tipe: 2, depth: 2, role: 'beban' },
];

module.exports = { ACCOUNTS };
