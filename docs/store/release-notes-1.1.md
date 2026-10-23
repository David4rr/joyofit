# JoyoFit 1.1 store release notes

Build state: app.json `version` 1.1, `ios.buildNumber` 2 (Android `versionCode` and iOS `CFBundleVersion` are stamped at build time, see docs/ci-release.md). Covers the native changes since the first store build plus JS features shipped by OTA. Do not claim store availability before the build is live. "Tested on" is only Huawei Watch Fit 4 Pro, Band 8, Band 11 Pro and Watch Fit 2.

## Google Play "What's new" (limit 500 characters each)

```
<id-ID>
Baru: masuk dengan Google langsung dari aplikasi (tanpa browser), impor ekspor data Huawei Health, termometer Xiaomi lewat bindkey, dinamika lari + "Ambil ulang dari jam", peringatan tanda tangan watch face, baterai lebih hemat, Lari-jalan di Coach, Joyo AI dengan kunci API sendiri, peta & grafik latihan panjang lebih halus. Jam lain selain yang teruji masih eksperimen.
</id-ID>
<en-US>
New: sign in with Google right in the app (no browser), import your Huawei Health data export, Xiaomi thermometer via bindkey, running dynamics + "Re-fetch from watch", watch-face signature warning, lower battery use, Run-walk plan in Coach, Joyo AI with your own API key, smoother maps and charts for long workouts. Watches beyond the tested ones are still experimental.
</en-US>
```

Lengths (characters): id 372, en 371.

## App Store "What's New in This Version" (limit 4000)

Indonesian:

```
- Baru di iPhone: daftar aplikasi notifikasi (WhatsApp, Telegram, Gmail, dan lainnya) plus saklar "Lainnya", dengan tombol Uji filter. Cara jam menerima perintahnya masih diuji, jadi belum dijamin berfungsi di semua jam.
- Dinamika lari (waktu kontak tanah, osilasi vertikal, rasio vertikal, keseimbangan kiri/kanan) bila jam mengirim datanya, dan "Ambil ulang dari jam" untuk melengkapi lari yang sudah tersinkron (hanya yang masih tersimpan di jam).
- Impor riwayat dari ekspor data Huawei Health.
- Peringatan sebelum mengunggah watch face tanpa tanda tangan ke jam yang mewajibkannya.
- Lari-jalan, rencana 8 minggu mulai lari lagi di Coach (butuh JoyoRogo Pro).
- Joyo AI: sambungkan kunci API milikmu sendiri (OpenRouter, OpenAI, Anthropic, Gemini).
- Peta menggambar semua titik GPS dan grafik lebih halus untuk latihan panjang.
- Perbaikan kecil dan stabilitas.
Teruji di Huawei Watch Fit 4 Pro, Band 8, Band 11 Pro, dan Huawei Watch Fit 2; jam lain masih eksperimen.
```

English:

```
- New on iPhone: a notification app list (WhatsApp, Telegram, Gmail and more) plus an "Others" switch, with a Test filter button. How the watch accepts the command is still being tested, so it is not guaranteed on every watch.
- Running dynamics (ground contact time, vertical oscillation, vertical ratio, left/right balance) when the watch sends them, and "Re-fetch from watch" to fill in runs already synced (only those the watch still holds).
- Import history from a Huawei Health data export.
- Warning before uploading an unsigned watch face to a watch that requires a signature.
- Run-walk, an 8-week restart-running plan in Coach (needs JoyoRogo Pro).
- Joyo AI: connect your own API key (OpenRouter, OpenAI, Anthropic, Gemini).
- Maps draw every GPS fix and charts are finer for long workouts.
- Small fixes and stability.
Tested on Huawei Watch Fit 4 Pro, Band 8, Band 11 Pro and Watch Fit 2; other watches are experimental.
```

## Android-only extras (Play, optional second paragraph or release name notes)

- Native Google sign-in through the Android account picker (browser kept as fallback).
- Xiaomi thermometer: stock firmware read with a bindkey, also overnight in the background.
- Battery: background wake locks are released as soon as a sync, visit or upload step ends, and notifications the watch would not show (own app, ongoing, calls, media, per-app off, watch without notification support) are dropped before any text or app info is read.

## Not claimed

Xiaomi bindkey reading and the iOS notification filter are untested on real hardware; Joyo AI provider privacy is the provider's own. Running dynamics only for watches that send them.
