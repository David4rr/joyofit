# JoyoFit on the App Store: listing copy and answers

What was entered in App Store Connect for app 6823324343 (version 1.0). Regenerate the screenshots with `node .tmp/storeframes/render.mjs` from the repo root
(frames in `.tmp/storeframes/frame.html`, source captures in `.tmp/storeframes/shots/`, output 1242x2688 for APP_IPHONE_65).

The screenshots are real captures of the app's own screens (the JS UI is shared with Android), framed with a drawn iPhone status bar. They are not iPhone captures: replace them with real ones when convenient.

## Names, URLs, keywords

| | id (primary) | en-US |
|---|---|---|
| Name | JoyoFit: Sinkron Jam Pintar | JoyoFit: Smartwatch Sync |
| Subtitle | Langkah, tidur, olahraga | Steps, sleep, workouts |
| Keywords | jam pintar,smartwatch,langkah,tidur,detak jantung,olahraga,strava,apple health,bluetooth,sinkron | smartwatch,steps,sleep,heart rate,workout,strava,apple health,fitness,bluetooth,sync,tracker |
| Promotional text | Sinkron langkah, tidur, detak jantung, dan olahraga dari jam Huawei ke iPhone-mu. Datanya tetap di HP. | Sync steps, sleep, heart rate and workouts from your Huawei watch to your iPhone. Your data stays on your phone. |

Privacy policy https://fit.joyorogo.com/privasi; support and marketing URL https://fit.joyorogo.com. Category Health & Fitness. Free, all territories (base IDN). Age rating 4+ (health topics only).
"Huawei" is kept out of the name, subtitle and keywords (guideline 5.2); the description uses it only for compatibility and says JoyoFit is not affiliated.

## Description (id)

```
JoyoFit menyambungkan jam Huawei langsung ke iPhone-mu lewat Bluetooth, tanpa akun Huawei dan tanpa server perantara. Data jam disimpan di iPhone-mu.

YANG BISA DILAKUKAN
• Sinkron langkah, jarak, kalori, detak jantung, SpO2, tidur, dan olahraga dari jam, lengkap dengan rute GPS dan tahap tidur.
• Lihat hari ini, tidur semalam, tren 30 dan 90 hari, kesiapan, beban latihan, dan riwayat olahraga dalam satu aplikasi.
• Simpan ke Apple Health (hanya menulis; JoyoFit tidak pernah membaca data Health-mu): langkah, jarak, energi aktif, detak jantung, SpO2, tidur, dan olahraga beserta rutenya.
• Kirim olahragamu ke Strava (opsional, gratis).
• Pasang dan ganti watch face, atur alarm, tampilkan cuaca di jam (dari Open-Meteo, opsional), dan nyalakan pengukuran detak jantung, SpO2, dan stres otomatis di jam.
• Cadangan cloud opsional, baru aktif setelah kamu masuk dengan akun JoyoRogo.

PRIVASI
• Data jam disimpan di iPhone-mu. Tidak ada iklan, tidak ada analitik, data tidak dijual.
• Cloud JoyoFit dan Strava bersifat opsional dan baru aktif setelah kamu sendiri menyalakannya.
• Kebijakan privasi: https://fit.joyorogo.com/privasi

CATATAN
• Butuh jam Huawei. Diuji dengan Huawei Watch Fit 4 Pro; jam lain belum dicoba di iPhone. Daftar jam: https://fit.joyorogo.com/jam
• Karena batasan iOS, JoyoFit tidak bisa meneruskan notifikasi aplikasi lain, mencari iPhone dari jam, mengatur panggilan, atau mengirim SMS SOS. Untuk notifikasi, jam membacanya langsung dari iPhone lewat pengaturan bawaan iOS. Fitur siklus, makanan, dan beberapa lainnya belum ada di iPhone.
• Tampilan aplikasi saat ini berbahasa Inggris.
• JoyoFit bukan produk Huawei dan tidak berafiliasi dengan Huawei. Huawei adalah merek dagang pemiliknya.
• JoyoFit bukan alat medis. Jangan dipakai untuk diagnosis atau pengobatan.

Open source (AGPL-3.0): https://github.com/dzulfikar08/joyofit
```

## Description (en-US)

```
JoyoFit connects your Huawei watch straight to your iPhone over Bluetooth, with no Huawei account and no middleman server. Your watch data stays on your iPhone.

WHAT IT DOES
• Syncs steps, distance, calories, heart rate, SpO2, sleep and workouts from the watch, with GPS routes and sleep stages.
• Shows today, last night's sleep, 30 and 90 day trends, readiness, training strain and workout history in one app.
• Saves to Apple Health (write only; JoyoFit never reads your Health data): steps, distance, active energy, heart rate, SpO2, sleep and workouts with their routes.
• Sends your workouts to Strava (optional, free).
• Installs and switches watch faces, sets alarms, shows weather on the watch (from Open-Meteo, optional) and turns on automatic heart rate, SpO2 and stress measurement on the watch.
• Optional cloud backup, which only starts after you sign in with a JoyoRogo account.

PRIVACY
• Watch data is stored on your iPhone. No ads, no analytics, your data is not sold.
• The JoyoFit cloud and Strava are optional and only start after you switch them on yourself.
• Privacy policy: https://fit.joyorogo.com/privasi

NOTES
• You need a Huawei watch. Tested with the Huawei Watch Fit 4 Pro; other watches have not been tried on iPhone. List: https://fit.joyorogo.com/jam
• Because of iOS limits, JoyoFit cannot forward other apps' notifications, find your iPhone from the watch, handle calls or send SOS texts. For notifications, the watch reads them from the iPhone itself through the built-in iOS setting. A few other features are not on iPhone yet.
• JoyoFit is not a Huawei product and is not affiliated with Huawei. Huawei is a trademark of its owner.
• JoyoFit is not a medical device. Do not use it for diagnosis or treatment.

Open source (AGPL-3.0): https://github.com/dzulfikar08/joyofit
```

## App Review notes

```
JoyoFit is a companion app for Huawei smartwatches (tested with the Huawei Watch Fit 4 Pro). Pairing and syncing need that hardware, which a reviewer normally does not have, so this note says what works without a watch.

NO SIGN-IN, NO DEMO ACCOUNT. Every feature of the app works without an account. Signing in with a JoyoRogo account (Settings, the cloud section) only turns on an optional cloud backup and the optional Strava upload. Leave both off. Nothing in the app is gated behind payment or an account; the app is free and has no in-app purchases or ads.

WITHOUT A WATCH you can still see: the four tabs (Today, Workouts, Watch, Settings) with their empty states; the Watch tab's "Before you connect" steps and the scan, which finds nothing when no watch is in range; every Settings screen (background sync, weather, Strava, Apple Health, profile and daily step goal, About with the privacy policy link, Log). Screens for features iOS does not allow (find my phone, calls, SOS texts) or that are not on iOS yet explain that instead of showing controls that would fail.

PERMISSIONS and why:
- Bluetooth: connect to the user's own Huawei watch (prompt appears when the user taps to scan or connect on the Watch tab).
- Apple Health (write only): saves steps, distance, active energy, heart rate, SpO2, sleep and workouts (with routes) recorded by the watch. JoyoFit never reads Apple Health. The prompt appears only when the user switches the export on in Settings.
- Location (when in use): optional, only for weather on the watch; coordinates are rounded to about 1 km before they go to Open-Meteo.
- Background mode bluetooth-central: reconnect and sync with the remembered watch when iOS wakes the app.
- Encryption: the protocol with the watch implements AES and HMAC itself; ITSAppUsesNonExemptEncryption is false (the encryption only protects the Bluetooth link to the user's watch; it is not used for anything else).

TRADEMARK: JoyoFit is an independent, open-source app (AGPL-3.0, https://github.com/dzulfikar08/joyofit). It is not affiliated with Huawei; "Huawei" appears only to say which watches it works with. The app name and icon do not use Huawei marks.

DEMO VIDEO: a screen recording of pairing and syncing a watch from an iPhone is available on request at dzulfikar@joyorogo.com.

The app UI is in English. Privacy policy: https://fit.joyorogo.com/privasi.
```

Contact: Dzulfikar Ats Tsauri, +6285156160345, dzulfikar@joyorogo.com. No demo account.

## App Privacy (published)

Collected, all for App Functionality only, no tracking: Name, Email Address, User ID, Device ID (the watch's Bluetooth address), Health, Fitness, Precise Location (workout GPS tracks): linked to the user, and only after the user signs in to the optional JoyoRogo cloud.
Coarse Location (weather position rounded to about 1 km, sent to Open-Meteo): not linked. Apple Health data is written only and never read, so it is not a collected row.
