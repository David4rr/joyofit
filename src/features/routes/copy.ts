import { mapCopy } from './map/copy';
import type { RouteSource } from './routeModel';

/**
 * Every user-facing string of the route screens, in one place so it can be translated later. Indonesian, casual "kamu",
 * the tone of `src/features/family/copy.ts`.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'] as const;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `18 Okt 2026` from epoch milliseconds, local time. */
export function formatRouteDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** `18 Okt 2026, 14:05` from epoch milliseconds, local time. */
export function formatRouteDateTime(ms: number): string {
  const d = new Date(ms);
  return `${formatRouteDate(ms)}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** The name given to a route that has none. */
export const untitledRouteName = (ms: number) => `Rute ${formatRouteDate(ms)}`;

/** The chip on a route: where it came from. */
export const SOURCE_LABEL: Record<RouteSource, string> = {
  gpx: 'GPX',
  tcx: 'TCX',
  drawn: 'Gambar',
  workout: 'Latihan',
};

export const copy = {
  titles: {
    library: 'Rute',
    detail: 'Rute',
    import: 'Impor rute',
    draw: 'Gambar rute',
  },

  /** The row in the Watch tab. */
  hub: {
    title: 'Rute',
    subtitle: 'Impor atau gambar rute, lalu kirim ke jam',
  },

  library: {
    addTitle: 'Tambah rute',
    importFile: 'Impor GPX/TCX',
    drawOnMap: 'Gambar di peta',
    fromWorkout: 'Dari latihan',
    listTitle: 'Rute tersimpan',
    loading: 'Membuka daftar rute',
    loadFailed: (message: string) => `Daftar rute tidak bisa dibaca: ${message}`,
    pickFailed: (message: string) => `Berkas tidak bisa dipilih: ${message}`,
    emptyTitle: 'Belum ada rute',
    emptyDescription:
      'Simpan rute di sini, lalu kirim ke jam supaya garis rute dan posisimu tampil saat lari, bersepeda, atau jalan di luar ruangan. Ada empat cara menambah rute:',
    ways: [
      'Pilih berkas GPX atau TCX dari ponselmu dengan Impor GPX/TCX.',
      'Buka berkas GPX atau TCX dari Strava, Garmin, Komoot, atau aplikasi lain, lalu pilih Bagikan atau Buka dengan JoyoFit.',
      'Gambar rute sendiri di peta dengan Gambar di peta.',
      'Pakai rute dari latihan yang pernah direkam jam kamu dengan Dari latihan.',
    ],
    neverSent: 'Belum pernah dikirim ke jam',
    lastSent: (ms: number) => `Terakhir dikirim ke jam ${formatRouteDateTime(ms)}`,
    openRoute: (name: string) => `Buka rute ${name}`,
    deleteRoute: (name: string) => `Hapus rute ${name}`,
    deleteTitle: 'Hapus rute ini?',
    deleteMessage: (name: string) =>
      `"${name}" dihapus dari ponsel ini. Rute yang sudah ada di jam tidak ikut terhapus, hapus di jam lewat menu Rute.`,
    deleteConfirm: 'Hapus',
    deleteFailed: (message: string) => `Rute tidak bisa dihapus: ${message}`,
    cancel: 'Batal',
  },

  /** The sheet that lists past workouts with a GPS track. */
  workoutPicker: {
    title: 'Pilih latihan',
    caption: 'Hanya latihan yang punya jejak GPS yang muncul di sini.',
    loading: 'Mencari latihan dengan jejak GPS',
    empty: 'Belum ada latihan dengan jejak GPS. Latihan luar ruangan yang direkam jam muncul di sini setelah tersinkron.',
    gpsPoints: (n: number) => `${n} titik GPS`,
    close: 'Tutup',
    saving: 'Menyimpan rute',
    loadFailed: (message: string) => `Daftar latihan tidak bisa dibaca: ${message}`,
    saveFailed: (message: string) => `Rute tidak bisa disimpan: ${message}`,
    noGps: 'Latihan ini tidak punya jejak GPS yang bisa dijadikan rute.',
    pick: (label: string) => `Jadikan rute: ${label}`,
    defaultName: (sportName: string, startSec: number) => `${sportName} ${formatRouteDate(startSec * 1000)}`,
  },

  /** On the workout detail screen. */
  workout: {
    save: 'Simpan sebagai rute',
    saving: 'Menyimpan rute',
    saved: (name: string) => `Tersimpan sebagai rute "${name}".`,
    open: 'Buka rute',
  },

  import: {
    reading: 'Membaca berkas rute',
    pickPrompt: 'Pilih berkas GPX atau TCX dari ponselmu. Rute dari Strava, Garmin, Komoot, dan aplikasi sejenis bisa dibaca.',
    pick: 'Pilih berkas GPX/TCX',
    pickAnother: 'Pilih berkas lain',
    previewTitle: 'Pratinjau rute',
    nameLabel: 'Nama rute',
    nameHint: 'Nama ini juga yang tampil di jam.',
    save: 'Simpan rute',
    saving: 'Menyimpan',
    tooLarge: 'Berkas ini terlalu besar untuk berkas rute (maksimal 20 MB).',
    unreadable: (message: string) => `Berkas tidak bisa dibuka: ${message}`,
    saveFailed: (message: string) => `Rute tidak bisa disimpan: ${message}`,
  },

  parse: {
    empty: 'Berkasnya kosong.',
    unrecognized: 'Ini bukan berkas GPX atau TCX, jadi JoyoFit tidak bisa membaca rutenya.',
    tooFewPoints: (found: number) =>
      found === 0
        ? 'Tidak ada titik rute yang valid di berkas ini. Rute butuh minimal 2 titik dengan koordinat yang jelas.'
        : `Berkas ini cuma punya ${found} titik rute yang valid. Rute butuh minimal 2 titik.`,
    tooFewForSave: 'Rute butuh minimal 2 titik dengan koordinat yang valid.',
  },

  detail: {
    loading: 'Membuka rute',
    notFound: 'Rute ini tidak ketemu. Mungkin sudah dihapus.',
    loadFailed: (message: string) => `Rute tidak bisa dibuka: ${message}`,
    statsTitle: 'Ringkasan',
    distance: 'Jarak',
    ascent: 'Naik',
    descent: 'Turun',
    points: 'Jumlah titik',
    altitude: 'Data ketinggian',
    altitudeYes: 'Ada',
    altitudeNo: 'Tidak ada',
    noAltitudeNote: 'Rute ini tidak punya data ketinggian, jadi jam cuma menampilkan garis rutenya.',
    source: 'Sumber',
    created: 'Dibuat',
    lastSent: 'Terakhir dikirim ke jam',
    neverSent: 'Belum pernah',
    nameTitle: 'Nama',
    nameLabel: 'Nama rute',
    nameHint: 'Nama ini juga yang tampil di jam.',
    saveName: 'Simpan nama',
    nameSaved: 'Nama tersimpan.',
    renameFailed: (message: string) => `Nama tidak bisa disimpan: ${message}`,
    deleteRoute: 'Hapus rute',
  },

  push: {
    title: 'Kirim ke jam',
    send: 'Kirim ke jam',
    explainer: 'Jam menyimpan rute dengan nama yang sama seperti di sini. Setelah terkirim, mulai rutenya langsung dari jam.',
    /** The name sent when a route's own name is empty. */
    watchFallbackName: 'Rute',
    needConnect: 'Sambungkan jam kamu dulu untuk mengirim rute.',
    openWatch: 'Buka Jam',
    unsupported: 'Jam ini tidak mencantumkan dukungan rute, jadi rute belum bisa dikirim ke sini.',
    appOutdated: 'Kirim rute butuh versi JoyoFit yang terbaru. Perbarui aplikasinya dulu.',
    preparing: 'Menyiapkan',
    sending: 'Mengirim',
    sendingPercent: (pct: number) => `Mengirim, ${pct}%`,
    waiting: 'Menunggu jam',
    progressLabel: 'Kemajuan pengiriman rute',
    sent: 'Rute terkirim ke jam.',
    sentPoints: (sent: number, total: number) =>
      sent < total
        ? `Jam menyimpan ${sent} dari ${total} titik. Jam menyederhanakan rute yang panjang, bentuknya tetap sama.`
        : `Jam menyimpan ${sent} titik.`,
    noFinalAnswer: 'Jam belum memberi konfirmasi akhir. Cek di menu Rute di jam untuk memastikan rutenya sudah masuk.',
    already: 'Rute dengan nama ini sudah ada di jam.',
    alreadyHint: 'Pakai rute yang sudah ada di jam, atau ganti nama rute ini lalu kirim lagi sebagai rute baru.',
    renameLabel: 'Nama baru',
    renameAndSend: 'Ganti nama dan kirim lagi',
    renameEmpty: 'Isi nama baru dulu.',
    notAccepted: (answerCode: number | null) =>
      answerCode === null
        ? 'Jam tidak menerima rute ini.'
        : `Jam tidak menerima rute ini (kode ${answerCode}).`,
    failedUnknown: (message: string, code: string | null) =>
      code && !message.includes(code) ? `Rute tidak terkirim: ${message} (${code})` : `Rute tidak terkirim: ${message}`,
    recordFailed: (message: string) => `Rute sudah terkirim, tapi catatan "terakhir dikirim" tidak bisa disimpan: ${message}`,
    errors: {
      ERR_NOT_CONNECTED: 'Jam tidak tersambung. Sambungkan jam dulu, lalu coba lagi.',
      ERR_UNSUPPORTED: 'Jam ini belum bisa menerima rute dari JoyoFit.',
      ERR_INVALID_ARGUMENT: (message: string) => `JoyoFit tidak bisa membuat berkas rute dari rute ini: ${message}`,
      ERR_ROUTE_FULL: 'Daftar rute di jam penuh. Hapus rute lama di jam (tekan lama rutenya di menu Rute), lalu kirim lagi.',
      ERR_ROUTE_NAME: 'Nama rute ini tidak bisa dipakai jam, biasanya karena terlalu panjang. Ganti dengan nama yang lebih pendek.',
      ERR_UPLOAD_REJECTED: (message: string) => `Jam menolak berkas rutenya. ${message}`,
      ERR_TIMEOUT: 'Jam tidak menjawab. Dekatkan jam ke ponsel, nyalakan layarnya, lalu coba lagi.',
      ERR_BUSY: 'Jam atau JoyoFit masih mengerjakan hal lain. Tunggu sebentar, lalu coba lagi.',
      ERR_DISCONNECTED: 'Sambungan ke jam terputus waktu mengirim. Sambungkan lagi, lalu coba lagi.',
    },
  },

  guide: {
    title: 'Cara memulai di jam',
    show: 'Lihat caranya',
    hide: 'Tutup',
    sentLead: 'Rutenya sudah di jam. Begini cara memakainya:',
    intro: 'Rute tidak jalan sendiri. Kamu memilihnya di jam sebelum mulai olahraga:',
    steps: [
      'Di jam, buka Olahraga (Workout).',
      'Pilih mode luar ruangan yang didukung: lari luar ruangan, bersepeda, atau jalan luar ruangan.',
      'Di layar sebelum mulai, ketuk ikon pengaturan (roda gigi) di sisi kanan. Di jam HarmonyOS 6, geser layar itu ke atas lalu ketuk Lainnya.',
      'Pilih Rute, lalu pilih rute yang baru kamu kirim.',
      'Nyalakan navigasi olahraga, lalu mulai olahraganya.',
    ],
    during: 'Selama olahraga, garis rute dan posisimu tampil di layar jam.',
    deleteOnWatch: 'Mau menghapus rute dari jam? Di menu Rute, tekan lama rutenya.',
    limitsTitle: 'Yang perlu kamu tahu',
    limits: [
      'Rute cuma untuk lari, bersepeda, dan jalan di luar ruangan.',
      'Jam menampilkan garis rute dan posisimu. Tidak ada petunjuk belok demi belok.',
      'Jam menyederhanakan rute yang panjang jadi beberapa ratus titik, jadi tikungan kecil bisa tidak tampil.',
      'Hanya jam yang mencantumkan dukungan rute yang bisa menerimanya.',
    ],
  },

  /** The map's own text lives with the map: `map/` adds its strings here under this key. */
  map: mapCopy,
} as const;
