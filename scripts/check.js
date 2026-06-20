'use strict';

/**
 * Cek cepat: pastikan neraca BALANCE untuk seluruh koperasi & tahun,
 * lalu tampilkan ringkasan. Jalankan: npm run check
 */

const { KOPERASI } = require('../src/koperasi');
const { balanceSummary, fractionsFromDates, FIRST_YEAR, LAST_YEAR } = require('../src/generator');

const rupiah = (n) => 'Rp' + n.toLocaleString('id-ID');
let gagal = 0;

// Periode uji: tahunan + triwulan + semester (year-to-date sampai tanggal cut-off).
const PERIODE = [
  { label: 'Triwulan I  ', sampai: '03-31' },
  { label: 'Semester I  ', sampai: '06-30' },
  { label: 'Triwulan III', sampai: '09-30' },
  { label: 'Tahunan     ', sampai: '12-31' },
];

for (const kode of Object.keys(KOPERASI)) {
  console.log(`\n=== ${kode} — ${KOPERASI[kode].nama} ===`);
  for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
    for (const p of PERIODE) {
      const { f0, f1 } = fractionsFromDates(year, `${year}-01-01`, `${year}-${p.sampai}`);
      const s = balanceSummary(kode, year, { f0, f1 });
      const tag = s.balance ? 'OK ' : 'XX ';
      if (!s.balance) gagal++;
      console.log(
        `  ${tag}${year} ${p.label} | Aset ${rupiah(s.total_aset).padStart(20)} | ` +
          `Pasiva ${rupiah(s.total_pasiva).padStart(20)} | ` +
          `SHU ${rupiah(s.shu).padStart(16)} | selisih ${s.selisih}`
      );
    }
  }
}

console.log(
  gagal === 0
    ? '\n✓ Semua periode (tahunan/semester/triwulan) BALANCE.\n'
    : `\n✗ Ada ${gagal} periode TIDAK balance!\n`
);
process.exit(gagal === 0 ? 0 : 1);
