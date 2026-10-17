import type { Post } from "../types.ts";

/** DRAFT. Not imported by the app. Publish with the steps at the top of ../index.ts when route navigation ships in a store build. */
export const navigasiRuteJam: Post = {
  slug: "navigasi-rute-jam",
  title: "Navigasi rute di jam: impor GPX, gambar rute, lalu Kirim ke jam",
  description:
    "Simpan rute di JoyoFit dari berkas GPX atau TCX, atau gambar sendiri di peta, lalu kirim ke jam Huawei dengan Kirim ke jam dan ikuti saat berlari atau bersepeda.",
  date: "2026-10-18",
  tag: "Rute",
  body: [
    {
      kind: "p",
      text: "Rute yang kamu siapkan di HP bisa ikut ke jam. JoyoFit menyimpan rutenya di pustaka rute, lalu mengirimnya ke jam lewat Bluetooth.",
    },
    { kind: "h2", text: "Tiga cara punya rute" },
    {
      kind: "ul",
      items: [
        "Impor berkas GPX atau TCX, lewat lembar berbagi (buka berkasnya dari aplikasi lain dan pilih JoyoFit) atau dari pemilih berkas.",
        "Gambar rute di peta.",
        "Simpan rute dari latihan yang sudah kamu rekam.",
      ],
    },
    { kind: "h2", text: "Kirim ke jam" },
    {
      kind: "ol",
      items: [
        "Buka rute di pustaka rute.",
        "Ketuk Kirim ke jam dan tunggu sampai selesai. Jam harus tersambung.",
        "Mulai latihan di jam dan ikuti rutenya. Panduan mulai di layar rute menjelaskan langkahnya di jam.",
      ],
    },
    {
      kind: "note",
      text: "Pengiriman rute baru diuji pada jam tertentu. Cek halaman [jam yang didukung](/jam) sebelum mengandalkannya di jalan, dan bawa rute cadangan.",
    },
  ],
  more: [
    { href: "/jam", label: "Jam yang didukung" },
    { href: "/blog/analisis-latihan", label: "Analisis latihan di JoyoFit" },
  ],
  verify: [
    "Nama persis tombol di build toko: 'Kirim ke jam', pustaka rute, 'start guide'. Aplikasi berbahasa Inggris; sesuaikan kalau berubah.",
    "Rute dikirim lewat P2P (handshake 5, berkas 6) dan commit-nya menyebut belum diverifikasi di Fit 4 Pro. Jangan terbitkan sebelum ada hasil uji di jam nyata, dan sebut jam mana yang berhasil.",
    "Daftar tiga cara punya rute: konfirmasi 'simpan dari latihan' benar-benar ada di build.",
    "Apakah iPhone ikut? Tulis eksplisit.",
    "Perbarui date ke tanggal rilis, hapus verify.",
    "Butuh screenshot baru: pustaka rute, gambar rute di peta, layar Kirim ke jam.",
  ],
};
