import type { Post } from "../types.ts";

export const tidurHrvCuaca: Post = {
  slug: "tidur-hrv-cuaca",
  title: "Tidur Watch Fit 2, HRV malam yang jujur, dan status cuaca",
  description:
    "Tidur tanpa tahap ditulis apa adanya, bukan dianggap tidur ringan. Kalau HRV malam tidak tersedia, JoyoFit bilang kenapa. Pengaturan juga menampilkan hasil kiriman prakiraan cuaca ke jam.",
  date: "2026-10-18",
  tag: "Data",
  body: [
    {
      kind: "p",
      text: "Tiga perbaikan kecil yang membuat angka di layar lebih bisa dipercaya.",
    },
    { kind: "h2", text: "Tidur di Watch Fit 2" },
    {
      kind: "p",
      text: "Sebagian jam, misalnya Huawei Watch Fit 2, mengirim rentang tidur tanpa tahap. Dulu rentang itu tampil sebagai tidur ringan. Sekarang ditulis Sleep (no stages), dan layar Today serta Sleep memberi petunjuk soal sakelar TruSleep di jam.",
    },
    { kind: "h2", text: "HRV malam yang jujur" },
    {
      kind: "p",
      text: "Recovery dan Readiness memakai HRV malam. Kalau datanya tidak ada, JoyoFit sekarang menyebut alasannya: jam tidak punya stres otomatis, belum ada rekaman dalam tiga malam terakhir, fiturnya mati, masih menunggu, atau tidak dibaca di iPhone. Readiness menyebut bahwa skornya dihitung tanpa HRV malam, tidak lagi menyuruh sinkron setelah tidur.",
    },
    { kind: "h2", text: "Cuaca ke jam" },
    {
      kind: "p",
      text: "Cuaca dan prakiraan datang dari Open-Meteo. Di Settings sekarang tampil hasil kiriman prakiraan terakhir: terkirim, tidak didukung jam, tidak dijawab jam, atau ditolak. Jadi kalau cuaca di jam kosong, kamu tahu bagian mana yang gagal.",
    },
    {
      kind: "p",
      text: "Laporan dukungan di aplikasi juga memuat baris status cuaca dan HRV malam, jadi laporan jam yang kamu kirim lebih mudah dibaca.",
    },
  ],
  more: [
    { href: "/jam", label: "Jam yang didukung" },
    { href: "/panduan", label: "Panduan pasang dan pakai" },
  ],
};
