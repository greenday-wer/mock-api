// Konfigurasi PM2 untuk menjalankan koperasi-mock-api di VPS.
//   Jalankan : pm2 start ecosystem.config.js
//   Simpan   : pm2 save && pm2 startup   (agar auto-start saat reboot)
//
// Aplikasi membaca process.env langsung (tanpa dotenv), jadi konfigurasi
// PORT & REQUIRE_API_KEY ditaruh di blok env di bawah ini.
module.exports = {
  apps: [
    {
      name: 'koperasi-mock-api',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        REQUIRE_API_KEY: 'true',
      },
    },
  ],
};
