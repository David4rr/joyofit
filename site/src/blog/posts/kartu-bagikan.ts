import type { Post } from "../types.ts";

export const kartuBagikan: Post = {
  slug: "kartu-bagikan",
  title: "Kartu bagikan: latihan dan hari ini sebagai gambar",
  description:
    "Bagikan latihan atau ringkasan Hari ini sebagai kartu gambar ke Instagram Stories, salin, atau simpan. Format Story 9:16 atau Square 1:1, dengan latar rute, fotomu, atau stiker transparan.",
  date: "2026-10-18",
  tag: "Berbagi",
  body: [
    {
      kind: "p",
      text: "Dari layar latihan atau layar Today, tombol bagikan membuka lembar berbagi dengan pratinjau kartu. Kartunya gambar selebar 1.080 piksel, siap ditempel ke mana saja.",
    },
    { kind: "h2", text: "Pilihan kartu" },
    {
      kind: "ul",
      items: [
        "Format: Story 9:16 atau Square 1:1.",
        "Latar untuk latihan: rute digambar besar di kartu gelap, fotomu sendiri (dari galeri atau kamera), atau stiker tanpa latar. Stiker disimpan sebagai PNG transparan supaya bisa ditempel di atas foto apa pun.",
        "Kartu Today: langkah, tidur, Recovery, Strain, dan Readiness hari itu.",
      ],
    },
    { kind: "h2", text: "Ke mana kartunya" },
    {
      kind: "ul",
      items: [
        "Instagram: langsung ke Stories. Kalau Instagram tidak terpasang, JoyoFit memakai lembar berbagi sistem.",
        "Copy: salin gambarnya ke clipboard.",
        "Save: simpan ke galeri. Di Android 11 ke atas tanpa izin penyimpanan; di iPhone, JoyoFit menjelaskan dulu sebelum iOS meminta izin foto.",
        "More: aplikasi lain lewat lembar berbagi sistem.",
      ],
    },
    {
      kind: "note",
      text: "Mau postingan yang bisa dikomentari teman? Pakai [Share to JoyoRogo](/blog/bagikan-latihan-ke-joyorogo). Kartu gambar hanya gambar.",
    },
  ],
  more: [{ href: "/blog/bagikan-latihan-ke-joyorogo", label: "Bagikan latihan dari jam ke JoyoRogo" }],
};
