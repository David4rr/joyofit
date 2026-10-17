import { IOS_TESTFLIGHT_LIVE, STRAVA_PATH } from "./lib.ts";

/** A tracking goal for the link at the end of an answer. */
export type FaqLink = { href: string; label: string; goal?: { name: string; location: string } };

export type FaqItem = { q: string; a: string; link?: FaqLink };

/**
 * The landing-page FAQ as plain text. The page renders it and the FAQPage
 * JSON-LD is built from the same entries, so the two cannot drift apart.
 */
export const FAQ: readonly FaqItem[] = [
  {
    q: "Apakah JoyoFit bisa menggantikan Huawei Health?",
    a: "JoyoFit adalah aplikasi open source (AGPL-3.0) yang bicara langsung ke jam Huawei lewat Bluetooth dan menyimpan langkah, detak jantung, tidur, SpO2, dan olahraga di HP-mu, jadi Huawei Health tidak perlu terpasang. Baru Huawei Watch Fit 4 Pro yang sudah diuji; jam lain masih eksperimen.",
  },
  {
    q: "Apakah saya perlu akun Huawei?",
    a: "Tidak. JoyoFit bicara langsung ke jam lewat Bluetooth. Yang perlu kamu lakukan: lepaskan jam dari Huawei Health dulu, karena jam hanya bisa terpasang ke satu aplikasi dalam satu waktu.",
  },
  {
    q: "Jam apa saja yang didukung?",
    a:
      "Baru Huawei Watch Fit 4 Pro yang sudah diuji. Jam dan band Huawei dan Honor lain di daftar Gadgetbridge (Bluetooth Classic maupun Bluetooth LE) masih eksperimen: jalurnya ada, tapi belum pernah dicoba dengan JoyoFit. Honor Watch 5, 5 Pro, dan 6 belum bisa. Di Android, pemindai di aplikasi sekarang juga menemukan band yang tidak muncul di pengaturan Bluetooth (Band 8, 9, 10, dan Fit), dan memberi pesan yang jelas kalau jam sedang dipegang HP lain. Daftar lengkapnya ada di halaman Jam yang didukung, dan kamu bisa membantu jam-mu masuk daftar uji di halaman Dukung jam. Aplikasinya untuk Android 10 ke atas, dan untuk iPhone dengan iOS 16.4 ke atas." +
      (IOS_TESTFLIGHT_LIVE
        ? " Versi iPhone ada sebagai beta publik lewat TestFlight, dan versi App Store 1.0 sedang menunggu review Apple. Baru diuji dengan Huawei Watch Fit 4 Pro."
        : ""),
  },
  {
    q: "Bisa dipakai di iPhone?",
    a: "Bisa, sebagai beta publik lewat TestFlight; versi App Store 1.0 sedang menunggu review Apple, jadi belum ada di App Store. Baru diuji dengan Huawei Watch Fit 4 Pro, dan beberapa fitur iPhone masih baru diuji di komputer.",
    link: { href: "/iphone", label: "Lihat cara pasang di iPhone", goal: { name: "iphone_waitlist_click", location: "faq" } },
  },
  {
    q: "Apa bedanya dengan Gadgetbridge?",
    a: "Protokol jam Huawei di JoyoFit adalah port dari Gadgetbridge (AGPL-3.0), dan daftar jam yang bisa dicoba mengikuti daftar Gadgetbridge. JoyoFit adalah turunannya, bukan Gadgetbridge itu sendiri: aplikasinya menambahkan layar harian, olahraga langsung, ekspor ke Health Connect dan Strava, cloud opsional, dan versi iPhone.",
  },
  {
    q: "Sudah stabil dipakai?",
    a: "Protokol jamnya porting dari Gadgetbridge. Tapi sebagian fitur, seperti kustomisasi tampilan jam, kartu kalori, dan latihan lari terjadwal, masih ditandai belum terverifikasi di Fit 4 di dokumentasi proyek. Kami jujur soal itu; log lengkapnya ada di Pengaturan.",
  },
  {
    q: "Ke mana data saya pergi?",
    a: "Ke database lokal di HP. Dua pengecualian, dan keduanya hanya jika kamu menyalakannya: cuaca ke Open-Meteo (hanya koordinat yang dibulatkan sekitar 1 km), dan cloud JoyoFit setelah kamu masuk dengan akun JoyoRogo.",
  },
  {
    q: "Apa yang diunggah ke cloud?",
    a: "Sampel langkah, segmen tidur, olahraga beserta titik rutenya, dan data perangkat. Saat ini aplikasi hanya mengunggah; membaca balik dari cloud belum ada. Penghapusan, profil, alarm, dan pengaturan tidak disinkronkan.",
  },
  {
    q: "Bisa dipakai tanpa cloud sama sekali?",
    a: "Bisa. Cloud opsional. Tanpa itu semua fitur jam tetap jalan dan data tetap di HP-mu.",
  },
  {
    q: "Bisa mengirim olahraga ke Strava?",
    a: "Bisa, gratis. Strava membatasi aplikasi kami di 10 atlet dan semua slotnya sedang terpakai; kami sudah mengajukan review ke Strava untuk menaikkan batas itu. Sampai disetujui, kamu bisa masuk daftar tunggu. Daftarnya sama untuk JoyoFit dan JoyoRogo, karena keduanya memakai satu aplikasi Strava.",
    link: { href: STRAVA_PATH, label: "Masuk daftar tunggu Strava", goal: { name: "strava_waitlist_click", location: "faq" } },
  },
  {
    q: "Apa hubungannya dengan JoyoRogo?",
    a: "JoyoRogo adalah aplikasi catatan makan kami. Asupan kalori dari JoyoRogo bisa tampil di kartu kalori jam, skor Recovery dan Strain JoyoFit ikut tampil di catatan makan JoyoRogo, dan masuk ke cloud JoyoFit memakai akun JoyoRogo. JoyoFit tetap bisa dipakai sendiri tanpa JoyoRogo.",
  },
];
