'use strict';

/**
 * Sumber tunggal data 5 koperasi mock — menggabungkan identitas koperasi
 * DAN data "informasi koperasi" yang dilayani endpoint
 *   GET /v1/without-auth/informasi-koperasi
 *
 * Model API key (mengikuti server asli):
 *   - MASTER_DATA_API_KEY : SATU kunci global untuk endpoint master data
 *     (informasi-koperasi, simpanan, pinjaman, simulasi).
 *   - apiKey (per-koperasi) : kunci AKUNTANSI untuk endpoint neraca lajur
 *     koperasi tsb (format "base64:..." seperti APP_KEY Laravel).
 *
 * Tiap koperasi memuat:
 *   - Parameter generator neraca : base (skala aset tahun 2020), growth (laju
 *     pertumbuhan tahunan), apiKey (kunci akuntansi/neraca koperasi ini).
 *   - Blok `informasi` : field PERSIS seperti respons API asli
 *       data.informasi = { id (UUID), nama, alamat, email, telepon, logo }
 *     plus created_at & updated_at (unix timestamp).
 *
 * Data sengaja dibuat variatif (skala kecil → besar, wilayah berbeda di Bali)
 * agar cocok sebagai data uji yang beragam.
 */

// Kunci API master data (global) — dipakai endpoint informasi/simpanan/pinjaman/simulasi.
const MASTER_DATA_API_KEY = 'base64:SW98SSB8ORaetCTPnJcwI3CoOYIrOeMt8jKfNxHU67Q=';

const KOPERASI = {
  KOP01: {
    kode: 'KOP01',
    nama: 'Koperasi Simpan Pinjam Laksita',
    base: 800000000,
    growth: 0.08,
    apiKey: 'base64:Gsh0VANY0eZOmZ1+H9I925j6Dq1VkGUh8ZKmh9Xvu7A=',
    informasi: {
      id: '019c5682-15b2-732a-87a6-171524e7650e',
      alamat: 'Jl. Gajah Mada No. 12, Denpasar',
      email: 'laksita@gmail.com',
      telepon: '081338551140',
      logo: 'informasi_koperasi/laksita.webp',
    },
    created_at: 1770975487,
    updated_at: 1770993620,
  },

  KOP02: {
    kode: 'KOP02',
    nama: 'Koperasi Serba Usaha Mertha Sari',
    base: 1800000000,
    growth: 0.1,
    apiKey: 'base64:+10GvlGMdokbj6Vabvc36+mugjy4HDUFsQfqlzTFT6w=',
    informasi: {
      id: '019c5a01-2c4d-7b91-9f02-2a6610b8c3d1',
      alamat: 'Jl. Raya Kuta No. 88, Badung',
      email: 'merthasari@gmail.com',
      telepon: '081236778210',
      logo: 'informasi_koperasi/merthasari.webp',
    },
    created_at: 1768824000,
    updated_at: 1771243200,
  },

  KOP03: {
    kode: 'KOP03',
    nama: 'KSP Dharma Artha',
    base: 3500000000,
    growth: 0.12,
    apiKey: 'base64:t5vgouSAfHSDGdO0FtHCUKacqtFpdpXJWF99KRpzRDY=',
    informasi: {
      id: '019c5b7e-8f3a-7c20-b1d4-3e7740c9a2f5',
      alamat: 'Jl. Astina Utara No. 5, Gianyar',
      email: 'dharmaartha@gmail.com',
      telepon: '081558890034',
      logo: 'informasi_koperasi/dharmaartha.webp',
    },
    created_at: 1767441600,
    updated_at: 1770556800,
  },

  KOP04: {
    kode: 'KOP04',
    nama: 'Koperasi Karyawan Bhakti Nusantara',
    base: 6500000000,
    growth: 0.09,
    apiKey: 'base64:65reXy0GC16E4134U/N6Nv4/mEUf/2JbZCKSNQlHjAQ=',
    informasi: {
      id: '019c5cf2-44e1-7d6b-a8c9-4f8851dab3e6',
      alamat: 'Jl. Ahmad Yani No. 101, Singaraja, Buleleng',
      email: 'kopkar.bhakti@gmail.com',
      telepon: '036222145',
      logo: 'informasi_koperasi/bhaktinusantara.webp',
    },
    created_at: 1766232000,
    updated_at: 1771502400,
  },

  KOP05: {
    kode: 'KOP05',
    nama: 'KSP Mitra Sentosa',
    base: 12000000000,
    growth: 0.14,
    apiKey: 'base64:cBgUM3ZIzLgpqFGgkRjshTpCNr7VlnmDSNMtsh7XFh0=',
    informasi: {
      id: '019c5e6a-90b7-7e15-c2f3-5a9962ebc4d7',
      alamat: 'Jl. Pahlawan No. 27, Tabanan',
      email: 'mitrasentosa@gmail.com',
      telepon: '081999012345',
      logo: 'informasi_koperasi/mitrasentosa.webp',
    },
    created_at: 1765022400,
    updated_at: 1771761600,
  },
};

/**
 * Respons penuh informasi-koperasi untuk satu koperasi, meniru kontrak asli:
 *   { message, data: { informasi:{id,nama,alamat,email,telepon,logo},
 *     created_at, updated_at }, auth }
 *
 * @param {string} kode - KOP01..KOP05
 * @returns {object|null}
 */
function buildInformasi(kode) {
  const k = KOPERASI[kode];
  if (!k) return null;
  return {
    message: 'Berhasil memperoleh data informasi koperasi.',
    data: {
      informasi: {
        id: k.informasi.id,
        nama: k.nama,
        alamat: k.informasi.alamat,
        email: k.informasi.email,
        telepon: k.informasi.telepon,
        logo: k.informasi.logo,
      },
      created_at: k.created_at,
      updated_at: k.updated_at,
    },
    auth: null,
  };
}

module.exports = { KOPERASI, MASTER_DATA_API_KEY, buildInformasi };
