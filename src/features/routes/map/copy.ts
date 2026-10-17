/** Every user-facing string of the route map and the drawing screen (Indonesian, "kamu"), kept in one place to translate later. */

export const mapCopy = {
  /** Shown on every map. The first two credits are the tile style and its data; the last one is the map data itself. */
  attribution: 'Peta: \u00A9 OpenFreeMap  \u00A9 OpenMapTiles  Data dari OpenStreetMap',
  routingCredit: 'Rute jalan: OSRM / FOSSGIS',
  searchCredit: 'Pencarian: Nominatim / OpenStreetMap',

  /** The native map module is not in this build. */
  unavailable: 'Peta butuh versi JoyoFit yang terbaru',
  unavailableCaption: 'Peta butuh versi JoyoFit yang terbaru. Ini gambar garis rutenya saja.',
  loadFailedCaption: 'Peta belum bisa dimuat, cek internetmu. Ini gambar garis rutenya saja.',
  mapLabel: (distance: string) => `Peta rute, ${distance}`,

  draw: {
    mapLabel: 'Peta untuk menggambar rute. Ketuk untuk menambah titik.',
    preparing: 'Menyiapkan peta',
    hintEmpty: 'Ketuk peta untuk menaruh titik pertama.',
    hintMore: 'Ketuk lagi untuk menambah titik.',
    points: (count: number) => `${count} titik`,
    findingRoute: 'Mencari jalur',
    waitForRoute: 'Tunggu jalurnya selesai dicari.',

    profiles: { foot: 'Jalan kaki', bike: 'Sepeda', straight: 'Garis lurus' },

    undo: 'Urungkan',
    clear: 'Bersihkan',
    clearTitle: 'Hapus semua titik?',
    clearMessage: 'Garis rute yang sudah kamu gambar akan hilang.',
    clearConfirm: 'Hapus',
    cancel: 'Batal',
    save: 'Simpan',

    routeFailed: 'Rute jalan tidak tersedia, pakai garis lurus untuk ruas ini',
    pointLimit: (max: number) => `Satu rute paling banyak ${max} titik. Simpan dulu rute ini.`,

    locate: 'Pusatkan ke lokasiku',
    locateFailed: 'Lokasimu belum terbaca. Coba lagi di tempat terbuka.',

    search: 'Cari tempat',
    searchPlaceholder: 'Nama jalan, kota, atau tempat',
    searchSubmit: 'Cari',
    searchHint: 'Teks yang kamu cari dikirim ke Nominatim (OpenStreetMap).',
    searchTooShort: 'Tulis minimal 3 huruf.',
    searchEmpty: 'Tempat itu tidak ketemu. Coba kata lain.',
    searchFailed: 'Pencarian tidak bisa dijangkau sekarang. Coba lagi sebentar.',
    searchClose: 'Tutup pencarian',
    pickPlace: (name: string) => `Pindah ke ${name}`,

    nameTitle: 'Beri nama rute',
    nameLabel: 'Nama rute',
    mapFailed: 'Peta belum bisa dimuat, cek internetmu. Titik yang kamu taruh tetap aman.',
    nameElevationHint: 'Saat disimpan, koordinat rute dikirim ke Open-Meteo untuk mengambil ketinggian. Kalau gagal, rute tersimpan tanpa ketinggian.',
    fetchingElevation: 'Mengambil ketinggian',
    saving: 'Menyimpan',
    saveFailed: (message: string) => `Rute belum tersimpan: ${message}`,
  },
} as const;
