'use strict';

/**
 * Cek cepat: pastikan neraca BALANCE untuk seluruh koperasi & tahun,
 * lalu tampilkan ringkasan. Jalankan: npm run check
 */

const { KOPERASI } = require('../src/koperasi');
const { balanceSummary, FIRST_YEAR, LAST_YEAR } = require('../src/generator');

const rupiah = (n) => 'Rp' + n.toLocaleString('id-ID');
let gagal = 0;

for (const kode of Object.keys(KOPERASI)) {
  console.log(`\n=== ${kode} — ${KOPERASI[kode].nama} ===`);
  for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
    const s = balanceSummary(kode, year);
    const tag = s.balance ? 'OK ' : 'XX ';
    if (!s.balance) gagal++;
    console.log(
      `  ${tag}${year} | Aset ${rupiah(s.total_aset).padStart(20)} | ` +
        `Pasiva ${rupiah(s.total_pasiva).padStart(20)} | ` +
        `SHU ${rupiah(s.shu).padStart(16)} | selisih ${s.selisih}`
    );
  }
}

console.log(
  gagal === 0
    ? '\n✓ Semua periode BALANCE.\n'
    : `\n✗ Ada ${gagal} periode TIDAK balance!\n`
);
process.exit(gagal === 0 ? 0 : 1);
