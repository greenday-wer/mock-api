'use strict';

/**
 * PRNG deterministik.
 *
 * Tujuan: angka yang dihasilkan untuk kombinasi (koperasi, tahun, akun) selalu
 * sama setiap kali server dipanggil — supaya pengujian dapat diulang
 * (reproducible) dan neraca tetap balance. Tidak memakai Math.random().
 */

// Hash string -> 53-bit integer (cyrb53).
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Angka pseudo-acak deterministik [0,1) dari sebuah seed string. */
function rand(seedStr) {
  const n = cyrb53(String(seedStr));
  return (n % 1000000) / 1000000;
}

/** Jitter simetris: rand -> [-amp, +amp]. */
function jitter(seedStr, amp) {
  return (rand(seedStr) * 2 - 1) * amp;
}

module.exports = { cyrb53, rand, jitter };
