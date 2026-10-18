import type { Post } from "../types.ts";

/** DRAFT. Not imported by the app. Publish with the steps at the top of ../index.ts when avatars in Social ship in a store build. */
export const fotoProfilSocial: Post = {
  slug: "foto-profil-social",
  title: "Foto profil di tab Social JoyoFit",
  description:
    "Postingan, komentar, dan anggota grup di tab Social JoyoFit sekarang menampilkan foto profil JoyoRogo, dengan inisial kalau belum ada foto.",
  date: "2026-10-18",
  tag: "Social",
  body: [
    {
      kind: "p",
      text: "Feed, komentar, daftar anggota grup, dan profil di tab Social menampilkan foto profil JoyoRogo. Yang belum punya foto tampil dengan inisial namanya.",
    },
    {
      kind: "p",
      text: "Foto diatur di profil JoyoRogo-mu, bukan di JoyoFit. Siapa yang bisa melihat profilmu mengikuti pengaturan privasi profil di JoyoRogo.",
    },
  ],
  more: [{ href: "/blog/social-joyofit", label: "Tab Social di JoyoFit" }],
  verify: [
    "Tulisan pendek ini bisa digabung ke 'social-joyofit' saat rilis, bukan jadi artikel sendiri.",
    "Cek di mana saja foto muncul (feed, komentar, anggota grup, profil) di build toko dan di iPhone.",
    "Cek kalimat privasi profil sesuai pengaturan JoyoRogo yang sebenarnya.",
    "Perbarui date, hapus verify. Screenshot baru: feed dengan foto profil.",
  ],
};
