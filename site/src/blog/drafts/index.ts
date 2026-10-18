// UNPUBLISHED. Nothing here is imported by the app, so it is not built, prerendered, listed in /blog
// or put in the sitemap. It is type-checked with the rest of src. Publish a draft with the steps at the
// top of ../index.ts when its feature ships in a store build.
import type { Post } from "../types.ts";
import { analisisLatihan } from "./analisis-latihan.ts";
import { coach } from "./coach.ts";
import { fotoProfilSocial } from "./foto-profil-social.ts";
import { keluarga } from "./keluarga.ts";
import { metrikKebugaran } from "./metrik-kebugaran.ts";
import { navigasiRuteJam } from "./navigasi-rute-jam.ts";

export const DRAFTS: readonly Post[] = [coach, analisisLatihan, navigasiRuteJam, keluarga, metrikKebugaran, fotoProfilSocial];
