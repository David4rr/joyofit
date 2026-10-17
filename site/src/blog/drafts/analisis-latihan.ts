import type { Post } from "../types.ts";

/** DRAFT. Not imported by the app. Publish with the steps at the top of ../index.ts when workout analysis ships in a store build. */
export const analisisLatihan: Post = {
  slug: "analisis-latihan",
  title: "Analisis latihan di JoyoFit: peta, split, grafik, zona, dan best effort",
  description:
    "Buka satu latihan dan lihat petanya, split per kilometer, grafik pace, detak jantung, elevasi, dan kadensi, waktu di tiap zona, serta best effort. Dihitung di HP dari data jam.",
  date: "2026-10-18",
  tag: "Olahraga",
  body: [
    {
      kind: "p",
      text: "Layar latihan di JoyoFit sekarang lebih dari angka total. Satu latihan dibuka sebagai analisis lengkap, semuanya dihitung di HP dari data yang direkam jam.",
    },
    { kind: "h2", text: "Yang ada di layar latihan" },
    {
      kind: "ul",
      items: [
        "Peta rute dengan tile peta, dan penunjuk yang bergerak mengikuti grafik.",
        "Split per kilometer: pace, detak jantung, dan naik turun tiap bagian.",
        "Grafik pace, detak jantung, elevasi, dan kadensi. Geser jarimu di grafik untuk melihat angka di titik itu.",
        "Waktu di tiap zona detak jantung.",
        "Best effort: bagian tercepat di dalam latihan itu.",
        "Lap dari jam atau dari berkas FIT kalau ada.",
      ],
    },
    { kind: "h2", text: "Yang perlu kamu tahu" },
    {
      kind: "p",
      text: "Grafik hanya sebagus data jamnya. Latihan tanpa GPS tidak punya peta, split jarak, atau elevasi, dan bagian yang tidak direkam jam tidak diisi. Semua angka turunan adalah perkiraan, bukan alat medis.",
    },
    {
      kind: "p",
      text: "Latihan yang sama bisa dibagikan ke JoyoRogo lewat [Share to JoyoRogo](/blog/bagikan-latihan-ke-joyorogo), dengan detak jantung dan rute ikut kalau kamu pilih.",
    },
  ],
  more: [
    { href: "/blog/strava-file-fit", label: "Kirim olahraga ke Strava sebagai file FIT" },
    { href: "/panduan", label: "Panduan pasang dan pakai" },
  ],
  verify: [
    "Tile peta: aplikasi memakai tile vektor OpenFreeMap tanpa modul native. Begitu fitur ini rilis, kalimat di landing 'Tanpa peta pihak ketiga' (BASICS di App.tsx) jadi tidak benar. Ubah, dan tambahkan OpenFreeMap/OpenStreetMap ke halaman /privasi (ada koneksi jaringan untuk tile).",
    "Cek tiap butir daftar terhadap build toko: split, penunjuk di grafik, lap, best effort, dan nama tombol/tab persis seperti di layar.",
    "Ganti 'sekarang lebih dari angka total' kalau layar lama masih terlihat di build toko.",
    "Perbarui date ke tanggal rilis, hapus verify.",
    "Butuh screenshot baru: layar latihan dengan peta + grafik (jangan dibuat-buat, ambil dari build toko).",
  ],
};
