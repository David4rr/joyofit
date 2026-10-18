import type { Post } from "../types.ts";

/** DRAFT. Not imported by the app. Publish with the steps at the top of ../index.ts when these metrics ship in a store build. */
export const metrikKebugaran: Post = {
  slug: "metrik-kebugaran",
  title: "VO2max, waktu pemulihan, beban latihan, dan Energi Tubuh di JoyoFit",
  description:
    "Metrik kebugaran harian yang dihitung di HP dari data jam-mu: VO2max, waktu pemulihan, beban latihan, prediksi lomba, status HRV, menit intensitas, dan Energi Tubuh. Perkiraan, bukan alat medis.",
  date: "2026-10-18",
  tag: "Metrik",
  body: [
    {
      kind: "p",
      text: "JoyoFit menambah metrik kebugaran yang dihitung di HP dari data jam: detak jantung, tidur, HRV, dan latihanmu. Semuanya perkiraan dengan metode yang dijelaskan di aplikasi, bukan alat medis.",
    },
    { kind: "h2", text: "Metriknya" },
    {
      kind: "ul",
      items: [
        "VO2max: perkiraan kebugaran aerobikmu dari latihan lari dan jalan dengan GPS dan detak jantung.",
        "Waktu pemulihan: perkiraan berapa jam sampai badanmu siap latihan berat berikutnya.",
        "Beban latihan: seberapa berat latihan beberapa pekan terakhir dibanding biasanya.",
        "Prediksi lomba: perkiraan waktu 5K, 10K, setengah maraton, dan maraton dari kebugaranmu sekarang.",
        "Status HRV: HRV malam dibanding baseline pribadimu.",
        "Menit intensitas: menit dengan detak jantung di zona sedang dan berat.",
        "Energi Tubuh: perkiraan simpanan energi harianmu, naik saat tidur dan istirahat, turun saat aktif dan stres.",
      ],
    },
    { kind: "h2", text: "Kenapa ada yang kosong" },
    {
      kind: "p",
      text: "Metrik ini butuh data. VO2max butuh latihan dengan GPS dan detak jantung, status HRV butuh beberapa malam dengan stres otomatis menyala di jam, dan Energi Tubuh butuh tidur yang terekam. Kalau datanya kurang, JoyoFit menampilkan alasannya, bukan angka tebakan.",
    },
    {
      kind: "note",
      text: "Angka ini perkiraan dari data jam dan rumus yang dipublikasikan. Jangan dipakai untuk keputusan medis. Nama Energi Tubuh adalah nama JoyoFit sendiri.",
    },
  ],
  more: [
    { href: "/#skor", label: "Recovery, Strain, dan Readiness" },
    { href: "/blog/tidur-hrv-cuaca", label: "HRV malam yang jujur" },
  ],
  verify: [
    "Daftar di atas ditulis dari daftar fitur yang direncanakan, bukan dari kode. Setiap butir (nama, cara hitung, syarat data, satuan) harus dicocokkan dengan build sebelum terbit, dan butir yang tidak jadi dihapus.",
    "Jangan pakai merek dagang pihak lain di mana pun (judul, deskripsi, perbandingan, alt teks): tidak ada 'Body Battery', tidak ada nama merek jam lain, tidak ada 'gaya Garmin'. Nama kita: Energi Tubuh. Hindari juga membandingkan akurasi dengan merek lain.",
    "Ganti kalimat deskriptif tiap metrik dengan rumus/sumber yang sebenarnya dipakai (landing sudah menulis rumus Recovery/Strain dengan rujukan; ikuti pola itu).",
    "Beda antara daftar di atas dan build (src/features/fitness, rumus lengkap di README bagian Fitness metrics): (a) VO2max memakai nilai dari jam kalau ada (METs maksimal x 3,5, dibulatkan ke bawah, jadi bisa 1 di bawah angka di jam), baru kalau tidak ada diperkirakan dengan Uth-Sorensen 2004 dari detak jantung istirahat; bukan dari latihan lari dan jalan. (b) Waktu pemulihan memakai angka dari jam, perkiraan dari strain hanya sebagai cadangan. (c) Beban latihan = rasio TRIMP 7 hari / 28 hari (Gabbett 2016) dengan status produktif, menjaga, pemulihan, terlalu berat, menurun. (d) Prediksi lomba memakai rumus Riegel dari rekor terbaik 5K, 10K, atau setengah maraton dalam 90 hari, dan baru tampil dengan minimal 3 lari ber-GPS; bukan 'dari kebugaran sekarang'. (e) Status HRV hanya Android (HRV malam): rata-rata 7 malam dibanding rentang 60 hari plus minus 1 simpangan baku, hasilnya seimbang, tidak seimbang, atau rendah. (f) Menit intensitas: zona 60 sampai 80 persen dihitung 1, 80 persen ke atas dihitung 2, target 150 per minggu (Senin sampai Minggu). (g) Energi Tubuh dan waktu pulih adalah kartu di Today, bukan layar sendiri; ada juga kebutuhan tidur malam ini; layar baru bernama Kebugaran.",
    "Tambahkan ke landing bagian Scores kalau metrik ini sekelas Recovery/Strain/Readiness, dan perbarui #skor sebagai jangkar atau ubah tautan 'more'.",
    "Tentukan apakah semua metrik rilis bersamaan; kalau bertahap, pecah jadi beberapa tulisan.",
    "Perbarui date ke tanggal rilis, hapus verify.",
    "Butuh screenshot baru: kartu metrik dan layar Energi Tubuh.",
  ],
};
