import type { FamilyScopes } from '@/cloud/family';

/** Text the family screens share. Wording of the disclaimer and the consent follows docs/family-monitoring.md section 7. */

/** Shown first on the consent screen, then as a card on every family screen. */
export const DISCLAIMER =
  'Ini bukan pantauan langsung. Data baru masuk setelah jam tersinkron ke ponsel dan ponselnya terhubung internet, jadi bisa telat dari beberapa menit sampai berjam-jam. JoyoFit bukan alat darurat dan tidak mendeteksi jatuh, serangan jantung, atau kondisi gawat. Kalau kamu khawatir, telepon langsung atau hubungi layanan darurat (112).';

export const consentTitle = (name: string) => `Izinkan ${name} melihat kabarmu?`;

export const consentIntro = (name: string) =>
  `${name} ingin ikut memantau kabarmu dari jam Huawei-mu. Kamu yang menentukan apa yang dibagikan.`;

export const NEVER_SHARED = 'Tidak pernah dibagikan: lokasi, rute olahraga, detak jantung per menit, makanan, foto.';

export const consentAlerts = (name: string) =>
  `${name} bisa dapat pemberitahuan kalau datamu terlihat tidak biasa, misalnya belum ada langkah sampai siang. Itu bukan diagnosis dokter.`;

export const consentRevoke = (name: string) =>
  `Kamu bisa jeda atau berhenti kapan saja. Kalau berhenti, ${name} langsung tidak bisa melihat apa pun dan riwayatnya kami hapus.`;

export interface ScopeRow {
  key: keyof FamilyScopes;
  label: string;
  hint?: string;
}

/** What a monitored person can share. `sync` is required: without the watch's last sync time the watcher could not tell a quiet day from a silent phone. */
export const SCOPE_ROWS: readonly ScopeRow[] = [
  { key: 'sync', label: 'Terakhir jam tersambung dan baterai', hint: 'Wajib, supaya kelihatan kalau datanya berhenti masuk.' },
  { key: 'steps', label: 'Langkah harian' },
  { key: 'sleep', label: 'Tidur semalam' },
  { key: 'restingHr', label: 'Detak jantung saat istirahat' },
  { key: 'spo2', label: 'Kadar oksigen (SpO2)', hint: 'Angka dari jam, bukan hasil ukur medis.' },
];

/** Nothing shared except the required sync time and battery: where every consent starts. */
export const CONSENT_DEFAULT_SCOPES: FamilyScopes = { sync: true, steps: false, sleep: false, restingHr: false, spo2: false };

export const PLATFORM_NOTE = {
  android:
    'Di Android, JoyoFit mengirim data di latar belakang setiap kali jam selesai tersinkron ke ponsel, juga saat JoyoFit tertutup. Kalau ponsel tidak ada internet, data menyusul saat tersambung lagi.',
  ios: 'Di iPhone, iOS yang menentukan kapan JoyoFit boleh mengirim di latar belakang. Sering kali data baru terkirim saat JoyoFit kamu buka atau saat jam membangunkannya, jadi kabar bisa telat.',
} as const;

/** The message that goes with an invite. `role` is the inviter's own side. The link opens the app (or the store); the code works by hand. */
export function inviteShareMessage(role: 'watcher' | 'monitored', url: string, code: string): string {
  const ask =
    role === 'watcher'
      ? 'Aku ingin ikut melihat kabarmu dari jam Huawei-mu lewat JoyoFit. Kamu yang menentukan apa yang dibagikan.'
      : 'Aku mengundangmu melihat kabarku dari jam Huawei-ku lewat JoyoFit.';
  return `${ask}\nBuka ${url} atau masukkan kode ${code} di JoyoFit (Keluarga, Masukkan kode undangan). Berlaku 48 jam, sekali pakai.`;
}

const LATE = 'Notifikasi bisa terlambat dan tidak menjamin kamu langsung tahu.';

/** Before the system prompt on the watcher's phone. */
export const prePermissionBody = (label: string) => `Aktifkan notifikasi supaya kamu dapat kabar dari ${label}. ${LATE}`;

/** Before the system prompt on the monitored person's phone, where "Tanya kabar" arrives. */
export const prePermissionMonitoredBody = (name: string) =>
  `Aktifkan notifikasi supaya kamu tahu kalau ${name} menanyakan kabarmu. ${LATE}`;

/** What a push's `data` can say: `family_alert` and `family_poke`, both with the link they are about. */
const LINK_ID = /^[A-Za-z0-9_-]+$/;

/** Where tapping a family notification goes; null for any other notification or a payload that does not name a link. */
export function notificationHref(data: unknown): `/family/${string}` | null {
  if (typeof data !== 'object' || data === null) return null;
  const { type, linkId } = data as { type?: unknown; linkId?: unknown };
  if (type !== 'family_alert' && type !== 'family_poke') return null;
  return typeof linkId === 'string' && LINK_ID.test(linkId) ? `/family/${linkId}` : null;
}

/** The person-facing sentence for an error answer of the Worker: its HTTP status (null = no answer) and `{error: code}`. */
export function familyErrorText(status: number | null, code: string | null): string {
  if (code === 'invite_invalid') return 'Kode undangan tidak berlaku. Mungkin sudah dipakai atau sudah lewat 48 jam.';
  if (code === 'own_invite') return 'Ini undangan yang kamu buat sendiri. Kirim ke orang lain.';
  if (code === 'limit_reached') return 'Batas jumlah orang sudah tercapai.';
  if (code === 'poke_throttled') return 'Kamu baru saja bertanya. Coba lagi sekitar satu jam lagi.';
  if (code === 'pro_required') return 'Ini untuk akun Pro.';
  if (code === 'already_linked') return 'Kalian sudah terhubung.';
  if (code === 'not_active') return 'Belum bisa, orang ini belum mengizinkan atau sedang menjeda.';
  if (code === 'not_pending') return 'Permintaan ini sudah kamu jawab.';
  if (status === null) return 'Tidak bisa terhubung. Periksa internet kamu lalu coba lagi.';
  if (status === 401) return 'Sesi JoyoRogo ditolak. Keluar lalu masuk lagi.';
  if (status === 403) return 'Kamu tidak punya akses ke sini.';
  if (status === 404) return 'Tidak ditemukan. Mungkin sudah dihapus.';
  if (status >= 500) return 'Server sedang bermasalah. Coba lagi sebentar.';
  return 'Terjadi kesalahan. Coba lagi.';
}
