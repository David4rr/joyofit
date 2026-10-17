import { useEffect } from "react";
import { ArrowLeft, Check, ChevronDown, Users } from "lucide-react";

import {
  GITHUB_URL,
  IOS_TESTFLIGHT_LIVE,
  IOS_TESTFLIGHT_URL,
  STRAVA_PATH,
  TESTER_GROUP_URL,
  TESTER_OPTIN_URL,
  WATCH_REPORT_FORM_URL,
  goal,
  setMeta,
} from "./lib";
import { JAM_BELUM_PAKE, JAM_BISA_DICOBA, JAM_SUDAH_DIUJI } from "./jam";
import { ButtonLink } from "./ui";

export const PANDUAN_PATH = "/panduan";

const META = {
  title: "Panduan pasang dan pakai JoyoFit",
  description:
    "Langkah demi langkah: pasang JoyoFit, lepas jam dari Huawei Health, pasangkan jam, beri izin, sinkron, sambungkan Strava, impor riwayat Huawei Health, dan atasi masalah umum. English guide below.",
};

type Lang = "id" | "en";
type Pair<T = React.ReactNode> = { id: T; en: T };

const link = "font-semibold text-primary underline underline-offset-4 hover:text-primary/80";

function B({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold">{children}</span>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-[0.85em] font-semibold">{children}</code>;
}

function List({ items }: { items: readonly React.ReactNode[] }) {
  return (
    <ul className="mt-3 space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5 text-[0.9375rem] leading-relaxed">
          <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Steps({ items }: { items: readonly React.ReactNode[] }) {
  return (
    <ol className="mt-3 space-y-4">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-extrabold tabular-nums">
            {i + 1}
          </span>
          <p className="pt-0.5 text-[0.9375rem] leading-relaxed">{item}</p>
        </li>
      ))}
    </ol>
  );
}

function Block({
  id,
  title,
  children,
  tone = "bg-card",
}: {
  id?: string;
  title: string;
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <section id={id} className={`scroll-mt-20 rounded-3xl p-5 md:p-6 ${tone}`}>
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-[0.9375rem] leading-relaxed">{children}</div>
    </section>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return <h3 className="pt-2 text-base font-bold">{children}</h3>;
}

function Chips({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {items.map((name) => (
        <li key={name} className="rounded-full bg-muted px-3 py-1 text-sm font-semibold">
          {name}
        </li>
      ))}
    </ul>
  );
}

const SECTIONS = [
  { key: "pasang", id: "1. Pasang JoyoFit", en: "1. Install JoyoFit" },
  { key: "sebelum", id: "2. Sebelum memasangkan jam", en: "2. Before pairing the watch" },
  { key: "pairing", id: "3. Pasangkan jam di JoyoFit", en: "3. Pair the watch in JoyoFit" },
  { key: "jam", id: "4. Jam yang didukung", en: "4. Supported watches" },
  { key: "izin", id: "5. Izin yang diminta", en: "5. Permissions" },
  { key: "fitur", id: "6. Sinkron, Strava, impor riwayat", en: "6. Sync, Strava, history import" },
  { key: "faq", id: "7. Jika ada masalah", en: "7. Troubleshooting" },
] as const;

type FaqItem = { q: Pair<string>; a: Pair };

const FAQ: readonly FaqItem[] = [
  {
    q: { id: "Jam tidak muncul di daftar", en: "The watch does not show up in the list" },
    a: {
      id: (
        <>
          Jam hanya bisa terhubung ke satu HP atau aplikasi dalam satu waktu, dan jam yang sedang terhubung ke yang lain tidak
          muncul. Pastikan jam sudah dilepas dari Huawei Health (Unbind) dan tidak terhubung ke HP lain atau JoyoFit di HP lain.
          Nyalakan jam, dekatkan ke HP, nyalakan Bluetooth, lalu di tab <B>Watch</B> ketuk <B>Scan nearby devices</B> atau tarik
          layar ke bawah untuk menyegarkan daftar. Kalau izin Perangkat sekitar ditolak, aplikasi menawarkan <B>Open app settings</B>.
          Jam yang belum pernah dipasangkan juga bisa dicari lewat Scan; atau pasangkan dulu di Pengaturan Bluetooth Android.
        </>
      ),
      en: (
        <>
          A watch can only link to one phone or app at a time, and one that is connected elsewhere does not show up. Make sure it
          is unbound from Huawei Health and not connected to another phone or to JoyoFit on another phone. Turn the watch on,
          bring it close, turn Bluetooth on, then on the <B>Watch</B> tab tap <B>Scan nearby devices</B> or pull down to refresh
          the list. If the Nearby devices permission was denied, the app offers <B>Open app settings</B>. A watch that was never
          paired can also be found with Scan; or pair it first in Android Bluetooth settings.
        </>
      ),
    },
  },
  {
    q: { id: "Tersangkut di layar QR setelah reset jam", en: "Stuck on the QR screen after resetting the watch" },
    a: {
      id: (
        <>
          JoyoFit tidak memakai kode QR: pairing-nya lewat Bluetooth, lalu konfirmasi di layar jam. Layar QR itu datang dari jam,
          bukan dari JoyoFit, dan kami belum bisa memastikan perilakunya di tiap model (hanya Watch Fit 4 Pro yang sudah diuji).
          Yang bisa dicoba: pastikan jam tidak sedang terhubung ke HP atau aplikasi lain, buka tab <B>Watch</B> → <B>Scan nearby
          devices</B> (atau pasangkan di Pengaturan Bluetooth Android), ketuk <B>Connect</B>, lalu setujui permintaan di jam dalam
          30 detik. Kalau jam tetap tidak muncul, <a className={link} href={WATCH_REPORT_FORM_URL} target="_blank" rel="noopener">kirim laporan jam</a>{" "}
          dengan model jam dan apa yang terlihat di layarnya.
        </>
      ),
      en: (
        <>
          JoyoFit does not use QR codes: pairing goes over Bluetooth and is confirmed on the watch screen. The QR screen comes
          from the watch, not from JoyoFit, and we cannot yet say how it behaves on every model (only the Watch Fit 4 Pro has
          been tested). What to try: make sure the watch is not connected to another phone or app, open <B>Watch</B> → <B>Scan
          nearby devices</B> (or pair it in Android Bluetooth settings), tap <B>Connect</B>, then accept the prompt on the watch
          within 30 seconds. If it still does not appear, <a className={link} href={WATCH_REPORT_FORM_URL} target="_blank" rel="noopener">send a watch report</a>{" "}
          with the model and what the screen shows.
        </>
      ),
    },
  },
  {
    q: { id: "Muncul pesan “Could not connect to the watch”", en: "“Could not connect to the watch” appears" },
    a: {
      id: (
        <>
          Biasanya jam masih terhubung ke aplikasi atau HP lain (Huawei Health, atau JoyoFit di HP lain). Putuskan di sana dulu,
          biarkan layar jam menyala dan dekat dengan HP, lalu ketuk <B>Retry</B>. Kalau jam belum dikenal HP ini, JoyoFit
          menampilkan <B>Pair this watch with this phone?</B>: melanjutkan menggantikan pairing jam dengan HP atau aplikasi
          lain, yang lalu harus dipasangkan ulang.
        </>
      ),
      en: (
        <>
          Usually the watch is still connected to another app or phone (Huawei Health, or JoyoFit on another phone). Disconnect
          it there first, keep the watch awake and close to this phone, then tap <B>Retry</B>. If this phone does not know the
          watch yet, JoyoFit asks <B>Pair this watch with this phone?</B>: continuing replaces the watch&apos;s pairing with
          the other phone or app, which then has to pair again.
        </>
      ),
    },
  },
  {
    q: { id: "Koneksi sering putus", en: "The connection keeps dropping" },
    a: {
      id: (
        <>
          Nyalakan <B>Keep connected in the background</B> di Pengaturan → Background and sync: layanan latar belakang menyambung
          ulang sendiri setelah putus (jeda 5 detik, berlipat sampai 5 menit) dan saat Bluetooth menyala. Kalau HP-mu mematikan
          layanan itu, kecualikan JoyoFit dari pembatasan baterai di pengaturan Android. Ketuk <B>Disconnect</B> di aplikasi
          menghentikan sambung ulang otomatis sampai kamu menyambung lagi. Dan ingat: kalau Huawei Health atau HP lain mengambil
          jam, JoyoFit kehilangan sambungannya.
        </>
      ),
      en: (
        <>
          Turn on <B>Keep connected in the background</B> under Settings → Background and sync: the background service
          reconnects by itself after a drop (5 s, doubling up to 5 min) and when Bluetooth turns on. If your phone kills that
          service, exempt JoyoFit from battery restrictions in Android settings. Tapping <B>Disconnect</B> in the app pauses
          auto-reconnect until you connect again. And remember: if Huawei Health or another phone takes the watch, JoyoFit
          loses the link.
        </>
      ),
    },
  },
  {
    q: { id: "Notifikasi tidak sampai ke jam", en: "Notifications do not reach the watch" },
    a: {
      id: (
        <>
          Buka Pengaturan → Notifications and calls: <B>Notification access</B> harus <B>Granted</B> dan{" "}
          <B>Forward notifications to the watch</B> menyala. Pilih aplikasinya di <B>Notification apps</B>. Pada build sendiri di Android 13 ke atas, izinkan dulu pengaturan terbatas: App info → menu tiga titik → <B>Allow restricted
          settings</B>.
        </>
      ),
      en: (
        <>
          Open Settings → Notifications and calls: <B>Notification access</B> must say <B>Granted</B> and{" "}
          <B>Forward notifications to the watch</B> must be on. Pick the apps under <B>Notification apps</B>. For a self-build on Android 13 and newer, first allow restricted settings: App info → the three-dot menu →{" "}
          <B>Allow restricted settings</B>.
        </>
      ),
    },
  },
  {
    q: { id: "Mau pindah ke HP lain", en: "Moving to another phone" },
    a: {
      id: "Jam menyimpan satu pairing HP. Memasangkannya di HP baru menggantikan pairing yang lama, jadi di HP lama jam akan perlu dipasangkan ulang. Data yang sudah disinkron tersimpan di HP lama (dan di cloud bila kamu memakainya).",
      en: "A watch keeps one phone pairing. Pairing it on the new phone replaces the old pairing, so the old phone will have to pair again. Data that was already synced stays on the old phone (and in the cloud if you use it).",
    },
  },
];

function Install({ lang }: { lang: Lang }) {
  const id = lang === "id";
  return (
    <>
      <Sub>{id ? "A. Lewat Google Play (tes tertutup)" : "A. Through Google Play (closed test)"}</Sub>
      <p>
        {id
          ? "JoyoFit di Google Play masih tes tertutup. Gratis, dan butuh Android 10 ke atas."
          : "JoyoFit on Google Play is still a closed test. Free, and it needs Android 10 or newer."}
      </p>
      <Steps
        items={
          id
            ? [
                "Gabung grup Google joyofit-testers dengan akun Google yang kamu pakai di Play Store. Grup inilah yang memberi akses ke tes tertutup.",
                "Setelah Google mengaktifkan aksesnya, buka halaman tes di Play dan ketuk Become a tester. Kalau halaman belum bisa dibuka, tunggu sebentar lalu coba lagi.",
                "Pasang JoyoFit dari Play Store. Data jam tetap tersimpan di HP; masuk dengan akun JoyoRogo hanya perlu kalau kamu mau cloud atau Strava.",
              ]
            : [
                "Join the Google group joyofit-testers with the Google account you use on the Play Store. The group is what gives access to the closed test.",
                "Once Google has enabled access, open the test page on Play and tap Become a tester. If the page does not open yet, wait a little and try again.",
                "Install JoyoFit from the Play Store. Watch data stays on the phone; signing in with a JoyoRogo account is only needed for the cloud or Strava.",
              ]
        }
      />
      <div className="flex flex-wrap gap-3 pt-1">
        <ButtonLink href={TESTER_GROUP_URL} target="_blank" rel="noopener" {...goal("tester_group_click", "panduan")}>
          <Users aria-hidden />
          {id ? "1. Gabung grup Google" : "1. Join the Google group"}
        </ButtonLink>
        <ButtonLink
          variant="outline"
          href={TESTER_OPTIN_URL}
          target="_blank"
          rel="noopener"
          {...goal("tester_optin_click", "panduan")}
        >
          {id ? "2. Become a tester di Play" : "2. Become a tester on Play"}
        </ButtonLink>
      </div>

      <Sub>{id ? "B. Build sendiri dari kode sumber" : "B. Build it yourself from source"}</Sub>
      <p>
        {id ? (
          <>
            JoyoFit hanya dibagikan lewat Google Play dan App Store; situs ini tidak menyediakan unduhan APK. Kode dan cara
            membangun sendiri ada di <a className={link} href={GITHUB_URL} target="_blank" rel="noopener">GitHub</a> (bagian
            Build di README). Build sendiri bisa mengaktifkan fitur tambahan yang tidak ada di versi toko: nama penelepon dari
            log panggilan dan SMS SOS.
          </>
        ) : (
          <>
            JoyoFit is shared only through Google Play and the App Store; this site does not offer an APK download. The code
            and how to build it yourself are on <a className={link} href={GITHUB_URL} target="_blank" rel="noopener">GitHub</a>{" "}
            (Build section of the README). A self-build can enable the extra features the store versions leave out: caller
            names from the call log and SOS texts.
          </>
        )}
      </p>
      <div className="rounded-2xl bg-muted p-4">
        <p className="font-semibold">
          {id ? "Jangan campur versi toko dan build sendiri" : "Do not mix the store version and a self-build"}
        </p>
        <p className="mt-1 text-muted-foreground">
          {id
            ? "Versi toko dan build sendiri ditandatangani kunci yang berbeda (Google yang menandatangani versi Play), dan Android tidak mau menimpa satu dengan yang lain. Kalau pindah dari salah satunya, uninstall yang lama dulu. Uninstall menghapus data lokal di HP, jadi sinkronkan ke cloud dulu kalau kamu memakainya."
            : "The store version and a self-build are signed with different keys (Google signs the Play version), and Android will not update one with the other. If you switch from one to the other, uninstall the old one first. Uninstalling wipes the local data on the phone, so upload to the cloud first if you use it."}
        </p>
      </div>

      {IOS_TESTFLIGHT_LIVE && (
        <>
          <Sub>{id ? "C. iPhone (beta)" : "C. iPhone (beta)"}</Sub>
          <p>
            {id ? (
              <>
                Versi iPhone beta lewat TestFlight: pasang TestFlight dari App Store, buka{" "}
                <a className={link} href={IOS_TESTFLIGHT_URL} target="_blank" rel="noopener" {...goal("ios_testflight_click", "panduan")}>undangan TestFlight</a>,
                ketuk Terima, lalu Pasang JoyoFit. Panduan di bawah ditulis untuk Android; langkah di iPhone mirip, dan
                tab Watch menampilkan petunjuknya sendiri.
              </>
            ) : (
              <>
                The iPhone version is a beta on TestFlight: install TestFlight from the App Store, open the{" "}
                <a className={link} href={IOS_TESTFLIGHT_URL} target="_blank" rel="noopener" {...goal("ios_testflight_click", "panduan")}>TestFlight invitation</a>,
                tap Accept, then Install JoyoFit. The guide below is written for Android; the iPhone steps are similar and
                the Watch tab shows its own instructions.
              </>
            )}
          </p>
        </>
      )}
    </>
  );
}

function BeforePairing({ lang }: { lang: Lang }) {
  const id = lang === "id";
  return (
    <>
      <Steps
        items={
          id
            ? [
                <>
                  <B>Lepaskan jam dari Huawei Health</B> (Unbind). Jam hanya bisa terikat ke satu aplikasi dalam satu waktu; kalau
                  masih terikat, jam menolak JoyoFit. Huawei Health tidak perlu terpasang untuk memakai JoyoFit, dan kamu tidak
                  butuh akun Huawei.
                </>,
                "Pastikan jam tidak sedang terhubung ke HP lain atau JoyoFit di HP lain.",
                <>
                  Nyalakan Bluetooth di HP, dan dekatkan jam. Jam yang sudah terpasang di Pengaturan Bluetooth Android akan
                  muncul di daftar JoyoFit (namanya seperti <Code>HUAWEI WATCH FIT 4-XXX</Code>); kalau belum, JoyoFit bisa
                  mencarinya lewat <B>Scan nearby devices</B> (Android 12 ke atas).
                </>,
              ]
            : [
                <>
                  <B>Unbind the watch from Huawei Health.</B> A watch can only be bound to one app at a time; if it is still
                  bound, it refuses JoyoFit. Huawei Health does not need to stay installed to use JoyoFit, and you do not need a
                  Huawei account.
                </>,
                "Make sure the watch is not connected to another phone or to JoyoFit on another phone.",
                <>
                  Turn Bluetooth on on the phone and bring the watch close. A watch already paired in Android Bluetooth settings
                  appears in JoyoFit&apos;s list (named like <Code>HUAWEI WATCH FIT 4-XXX</Code>); if not, JoyoFit can find it
                  with <B>Scan nearby devices</B> (Android 12 and newer).
                </>,
              ]
        }
      />
      <div className="rounded-2xl bg-muted p-4">
        <p className="font-semibold">
          {id ? "Perlu reset pabrik jam? Tidak wajib." : "Do you need a factory reset of the watch? Not required."}
        </p>
        <p className="mt-1 text-muted-foreground">
          {id
            ? "Melepas jam dari Huawei Health sudah cukup. Reset pabrik jam juga berhasil sebagai cara melepasnya, tapi menghapus semua yang ada di jam. JoyoFit sendiri tidak punya langkah reset atau pindai QR."
            : "Unbinding from Huawei Health is enough. A factory reset of the watch also works as a way to release it, but it wipes everything on the watch. JoyoFit itself has no reset or QR-scan step."}
        </p>
      </div>
      <div className="rounded-2xl bg-makan-soft p-4 text-makan-ink">
        <p className="font-semibold">
          {id ? "Mau membawa riwayat Huawei Health? Lakukan ini sebelum melepas jam." : "Want to bring your Huawei Health history? Do this before unbinding."}
        </p>
        <p className="mt-1">
          {id
            ? "Sinkronkan jam sekali lagi di Huawei Health (tarik layar ke bawah) karena data yang hanya ada di jam hilang saat jam dilepas, dan minta ekspor datamu (langkahnya ada di bagian 6)."
            : "Sync the watch once more in Huawei Health (pull down), because data only on the watch is lost when it is unbound, and request your data export (the steps are in section 6)."}
        </p>
      </div>
    </>
  );
}

function Pairing({ lang }: { lang: Lang }) {
  const id = lang === "id";
  return (
    <>
      <p>
        {id
          ? "Nama tombol di aplikasi berbahasa Inggris, jadi ditulis apa adanya di sini."
          : "Button names are quoted exactly as they appear in the app."}
      </p>
      <Steps
        items={
          id
            ? [
                <>
                  Buka tab <B>Watch</B>. Aplikasi meminta izin <B>Nearby devices</B> (Bluetooth); ketuk <B>Continue</B> dan
                  izinkan. Kalau sudah terlanjur ditolak, ketuk <B>Open app settings</B>.
                </>,
                <>
                  Di <B>Available watches</B> pilih jam-mu. Belum muncul? Ketuk <B>Scan nearby devices</B>, atau pasangkan di
                  Pengaturan Android → Bluetooth.
                </>,
                <>
                  Ketuk <B>Connect</B> pada jam itu.
                </>,
                <>
                  Kalau jam belum dikenal HP ini, muncul <B>Pair this watch with this phone?</B>. Ketuk <B>Continue</B>.
                  (Itu menggantikan pairing jam dengan HP atau aplikasi lain.)
                </>,
                "Biarkan layar jam menyala dan setujui permintaan di jam dalam 30 detik.",
                <>
                  Status berubah menjadi tersambung. Buka <B>Today</B> lalu ketuk <B>Sync now</B> untuk sinkron pertama.
                </>,
              ]
            : [
                <>
                  Open the <B>Watch</B> tab. The app asks for the <B>Nearby devices</B> (Bluetooth) permission; tap{" "}
                  <B>Continue</B> and allow it. If it was already denied, tap <B>Open app settings</B>.
                </>,
                <>
                  Under <B>Available watches</B> pick your watch. Not there yet? Tap <B>Scan nearby devices</B>, or pair it in
                  Android Settings → Bluetooth.
                </>,
                <>
                  Tap <B>Connect</B> on that watch.
                </>,
                <>
                  If this phone does not know the watch yet, <B>Pair this watch with this phone?</B> appears. Tap{" "}
                  <B>Continue</B>. (This replaces the watch&apos;s pairing with another phone or app.)
                </>,
                "Keep the watch screen awake and accept the prompt on the watch within 30 seconds.",
                <>
                  The status changes to connected. Open <B>Today</B> and tap <B>Sync now</B> for the first sync.
                </>,
              ]
        }
      />
      <p className="text-muted-foreground">
        {id
          ? "Forget pairing di tab Watch hanya menghapus kunci pairing yang disimpan JoyoFit; pairing Bluetooth Android tidak disentuh. Sambungan berikutnya jadi pairing pertama lagi dan perlu dikonfirmasi di jam."
          : "Forget pairing on the Watch tab only drops the pairing key JoyoFit stored; the Android Bluetooth pairing is not touched. The next connect is a first-time pairing again and has to be confirmed on the watch."}
      </p>
    </>
  );
}

function Watches({ lang }: { lang: Lang }) {
  const id = lang === "id";
  return (
    <>
      <p>
        {id ? (
          <>
            Baru <B>Huawei Watch Fit 4 Pro</B> yang sudah diuji dengan JoyoFit. Dari {JAM_BISA_DICOBA} model jam dan band Huawei dan
            Honor yang bisa dicoba, sisanya masih eksperimen: jalurnya ada, tapi belum pernah dicoba. Kalau jam-mu eksperimen, sambungkan sekali lalu
            kirim laporan (tab Watch → Help support your watch → Report on GitHub), supaya modelnya bisa naik jadi teruji.
          </>
        ) : (
          <>
            Only the <B>Huawei Watch Fit 4 Pro</B> has been tested with JoyoFit. Of the {JAM_BISA_DICOBA} Huawei and Honor watch and band
            models it can try, the rest are experimental: the path exists but has not been tried. If yours is experimental, connect once and
            send a report (Watch tab → Help support your watch → Report on GitHub) so the model can move up to tested.
          </>
        )}
      </p>
      <p className="font-semibold">{id ? "Sudah diuji" : "Tested"}</p>
      <Chips items={JAM_SUDAH_DIUJI} />
      <p className="font-semibold">{id ? "Belum bisa" : "Not yet"}</p>
      <p className="text-muted-foreground">
        {id
          ? "Pairing baru Honor (HiChain PAKE) belum diimplementasi, dan earphone bukan jam."
          : "Honor's newer pairing (HiChain PAKE) is not implemented, and earphones are not watches."}
      </p>
      <Chips items={JAM_BELUM_PAKE} />
      <p>
        {id ? (
          <>
            Daftar lengkap model eksperimen ada di halaman{" "}
            <a className={link} href="/jam">Jam yang didukung</a>. Jam Huawei atau Honor yang tidak ada di daftar tetap dicoba
            dengan cara yang sama dan mungkin tidak berhasil; selain Huawei dan Honor ditolak.
          </>
        ) : (
          <>
            The full list of experimental models is on the <a className={link} href="/jam">Supported watches</a> page. A Huawei or
            Honor watch that is not listed is tried the same way and may not work; anything that is not Huawei or Honor is
            refused.
          </>
        )}
      </p>
    </>
  );
}

function Permissions({ lang }: { lang: Lang }) {
  const id = lang === "id";
  return (
    <>
      <p>
        {id
          ? "Aplikasi hanya meminta izin saat kamu membuka fitur yang membutuhkannya. Yang penting untuk memulai:"
          : "The app only asks for a permission when you open the feature that needs it. What matters to get started:"}
      </p>
      <List
        items={
          id
            ? [
                <>
                  <B>Nearby devices (Bluetooth)</B>: wajib, diminta di tab Watch. Untuk menampilkan jam yang dipasangkan dan
                  membuka sambungan. Tidak butuh izin lokasi.
                </>,
                <>
                  <B>Notifikasi</B> (Android 13 ke atas): diminta saat kamu menyalakan <B>Keep connected in the background</B>.
                  Ditolak pun layanan tetap jalan, hanya notifikasinya tersembunyi.
                </>,
                <>
                  <B>Akses notifikasi</B> (Notification access): untuk meneruskan notifikasi ke jam. Pengaturan → Notifications
                  and calls → <B>Open notification access</B>, izinkan JoyoFit, lalu nyalakan{" "}
                  <B>Forward notifications to the watch</B>. Pilih aplikasinya di <B>Notification apps</B>. Pada build sendiri di Android 13 ke atas, izinkan <B>Allow restricted settings</B> dulu (bagian 1).
                </>,
                <>
                  <B>Latar belakang</B>: Pengaturan → Background and sync → nyalakan <B>Keep connected in the background</B>.
                  Interval sinkron bisa 15 menit sampai 4 jam.
                </>,
                <>
                  <B>Optimasi baterai</B>: aplikasi tidak memintanya. Kalau HP-mu mematikan layanan latar belakang, kecualikan
                  JoyoFit dari pembatasan baterai di pengaturan Android.
                </>,
              ]
            : [
                <>
                  <B>Nearby devices (Bluetooth)</B>: required, asked on the Watch tab. To list the paired watch and open the link.
                  No location permission needed.
                </>,
                <>
                  <B>Notifications</B> (Android 13 and newer): asked when you turn on <B>Keep connected in the background</B>.
                  If denied the service still runs, only its notification is hidden.
                </>,
                <>
                  <B>Notification access</B>: to forward notifications to the watch. Settings → Notifications and calls →{" "}
                  <B>Open notification access</B>, allow JoyoFit, then turn on <B>Forward notifications to the watch</B>. Pick
                  the apps under <B>Notification apps</B>. For a self-build on Android 13 and newer, allow{" "}
                  <B>Allow restricted settings</B> first (section 1).
                </>,
                <>
                  <B>Background</B>: Settings → Background and sync → turn on <B>Keep connected in the background</B>. The sync
                  interval can be 15 minutes to 4 hours.
                </>,
                <>
                  <B>Battery optimization</B>: the app does not ask for it. If your phone kills the background service, exempt
                  JoyoFit from battery restrictions in Android settings.
                </>,
              ]
        }
      />
      <p className="text-muted-foreground">
        {id
          ? "Opsional, hanya diminta bila kamu menyalakan fiturnya: lokasi (cuaca dan GPS olahraga luar ruang, hanya saat aplikasi dipakai), status telepon dan menjawab panggilan (panggilan di jam), dan Health Connect (menulis data jam untuk aplikasi lain)."
          : "Optional, only asked when you switch the feature on: location (weather and GPS for outdoor workouts, only while the app is in use), phone state and answering calls (calls on the watch), and Health Connect (writing watch data for other apps)."}
      </p>
    </>
  );
}

function Features({ lang }: { lang: Lang }) {
  const id = lang === "id";
  return (
    <>
      <Sub>{id ? "Sinkron" : "Sync"}</Sub>
      <p>
        {id ? (
          <>
            Buka <B>Today</B> dan ketuk <B>Sync now</B> (atau tarik layar ke bawah). Sinkron pertama menarik semua riwayat yang
            masih disimpan jam; yang berikutnya mulai dari sinkron terakhir. Dengan <B>Keep connected in the background</B>,
            sinkron jalan sendiri tiap 30 menit (bisa diubah) dan data terkumpul walau aplikasi ditutup.
          </>
        ) : (
          <>
            Open <B>Today</B> and tap <B>Sync now</B> (or pull down). The first sync pulls everything the watch still holds; later
            ones start from the previous sync. With <B>Keep connected in the background</B>, sync runs by itself every 30 minutes
            (configurable) and data accumulates even with the app closed.
          </>
        )}
      </p>

      <Sub>Strava</Sub>
      <p>
        {id ? (
          <>
            Pengaturan → <B>Strava</B> mengirim olahraga dari jam ke akun Strava-mu sendiri. Gratis, tidak perlu JoyoRogo Pro.
            Kamu perlu masuk dengan akun JoyoRogo dulu (<B>Sign in with JoyoRogo</B>), lalu ketuk <B>Connect with Strava</B>.
            Olahraga yang selesai setelah tersambung dikirim otomatis setelah tiap sinkron; yang lebih lama bisa dikirim dengan{" "}
            <B>Send to Strava</B> di layar olahraganya.
          </>
        ) : (
          <>
            Settings → <B>Strava</B> sends watch workouts to your own Strava account. Free, no JoyoRogo Pro needed. Sign in with
            a JoyoRogo account first (<B>Sign in with JoyoRogo</B>), then tap <B>Connect with Strava</B>. Workouts that finish
            after you connect are sent after each sync; older ones can be sent with <B>Send to Strava</B> on the workout screen.
          </>
        )}
      </p>
      <p className="rounded-2xl bg-muted p-4">
        {id ? (
          <>
            <B>Kuota terbatas sementara.</B> Strava membatasi jumlah atlet untuk aplikasi baru sampai aplikasinya disetujui,
            jadi sambungan Strava masih lewat undangan.{" "}
            <a className={link} href={STRAVA_PATH} {...goal("strava_waitlist_click", "panduan")}>Daftar undangan Strava</a>.
          </>
        ) : (
          <>
            <B>Limited quota for now.</B> Strava caps the number of athletes for a new app until it is approved, so the Strava
            connection is still by invitation.{" "}
            <a className={link} href={STRAVA_PATH} {...goal("strava_waitlist_click", "panduan")}>Join the Strava waitlist</a>.
          </>
        )}
      </p>

      <Sub>{id ? "Impor riwayat Huawei Health" : "Import Huawei Health history"}</Sub>
      <p>
        {id
          ? "Pengaturan → Import from Huawei Health membawa detak jantung, tidur, langkah, dan olahraga dari akun Huawei Health ke JoyoFit. Gratis, jalan di HP, dan tidak mengirim apa pun ke mana-mana."
          : "Settings → Import from Huawei Health brings heart rate, sleep, steps and workouts from your Huawei Health account into JoyoFit. Free, runs on the phone and sends nothing anywhere."}
      </p>
      <Steps
        items={
          id
            ? [
                <>
                  Minta datamu ke Huawei di <Code>privacy-sg.consumer.huawei.com/privacycenter</Code> (untuk akun Indonesia), atau
                  di Huawei Health → Me → akunmu → Privacy Center. Pilih <B>Request Your Data</B> dan centang <B>Health</B>.
                </>,
                "Atur password untuk ZIP dan ingat. Huawei menyiapkan berkasnya dan mengirim tautan unduhan lewat email: sampai 7 hari, dan tautannya berlaku 21 hari.",
                "Sebelum melepas jam dari Huawei Health, sinkronkan sekali lagi di sana. Data yang hanya ada di jam hilang saat dilepas.",
                <>
                  Unduh ZIP-nya, di JoyoFit pilih <B>Choose the ZIP file</B>, isi password, lalu ketuk <B>Import</B>.
                </>,
              ]
            : [
                <>
                  Request your data from Huawei at <Code>privacy-sg.consumer.huawei.com/privacycenter</Code> (for Indonesian
                  accounts), or in Huawei Health → Me → your account → Privacy Center. Choose <B>Request Your Data</B> and tick{" "}
                  <B>Health</B>.
                </>,
                "Set a password for the ZIP and remember it. Huawei prepares the file and emails a download link: up to 7 days, and the link works for 21 days.",
                "Before unbinding the watch from Huawei Health, sync it there once more. Data only on the watch is lost when it is unbound.",
                <>
                  Download the ZIP, in JoyoFit pick <B>Choose the ZIP file</B>, enter the password, then tap <B>Import</B>.
                </>,
              ]
        }
      />
      <p className="text-muted-foreground">
        {id
          ? "Data jam yang sudah ada tidak ditimpa, dan hasil impor tidak ikut diunggah ke cloud, Health Connect, atau Strava. Fitur ini baru dan belum diperiksa dengan berkas ekspor asli; kalau ada yang tidak terbaca, laporkan di GitHub."
          : "Existing watch data is never replaced, and imported rows are not uploaded to the cloud, Health Connect or Strava. The feature is new and has not been checked against a real export file; if something does not read, report it on GitHub."}
      </p>
    </>
  );
}

function Faq({ lang }: { lang: Lang }) {
  return (
    <div className="divide-y divide-border/70 rounded-3xl bg-card">
      {FAQ.map((item) => (
        <details key={item.q.id} className="group px-5 md:px-6">
          <summary className="-mx-2 flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-2 py-4 text-base font-bold focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
            {item.q[lang]}
            <ChevronDown
              className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden
            />
          </summary>
          <p className="pb-5 text-[0.9375rem] leading-relaxed text-muted-foreground">{item.a[lang]}</p>
        </details>
      ))}
    </div>
  );
}

function Guide({ lang }: { lang: Lang }) {
  const prefix = lang === "id" ? "" : "en-";
  const body: Record<(typeof SECTIONS)[number]["key"], React.ReactNode> = {
    pasang: <Install lang={lang} />,
    sebelum: <BeforePairing lang={lang} />,
    pairing: <Pairing lang={lang} />,
    jam: <Watches lang={lang} />,
    izin: <Permissions lang={lang} />,
    fitur: <Features lang={lang} />,
    faq: null,
  };
  return (
    <div lang={lang} className="space-y-3">
      <nav aria-label={lang === "id" ? "Isi panduan" : "Guide contents"} className="rounded-3xl bg-card p-5 md:p-6">
        <ul className="grid gap-1 sm:grid-cols-2">
          {SECTIONS.map((s) => (
            <li key={s.key}>
              <a
                href={`#${prefix}${s.key}`}
                className="inline-flex min-h-11 items-center text-[0.9375rem] font-semibold text-primary underline-offset-4 hover:underline"
              >
                {s[lang]}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {SECTIONS.map((s) =>
        s.key === "faq" ? (
          <section key={s.key} id={`${prefix}${s.key}`} className="scroll-mt-20 pt-3">
            <h2 className="mb-3 text-lg font-bold tracking-tight">{s[lang]}</h2>
            <Faq lang={lang} />
          </section>
        ) : (
          <Block key={s.key} id={`${prefix}${s.key}`} title={s[lang]}>
            {body[s.key]}
          </Block>
        ),
      )}
      <p className="pt-2 text-sm text-muted-foreground">
        {lang === "id" ? (
          <>
            Masih buntu? <a className={link} href={WATCH_REPORT_FORM_URL} target="_blank" rel="noopener">Kirim laporan jam</a>{" "}
            atau buka isu di <a className={link} href={GITHUB_URL} target="_blank" rel="noopener">GitHub</a>.
          </>
        ) : (
          <>
            Still stuck? <a className={link} href={WATCH_REPORT_FORM_URL} target="_blank" rel="noopener">Send a watch report</a>{" "}
            or open an issue on <a className={link} href={GITHUB_URL} target="_blank" rel="noopener">GitHub</a>.
          </>
        )}
      </p>
    </div>
  );
}

export function PanduanPage() {
  useEffect(() => {
    const { title, description } = META;
    const url = `https://fit.joyorogo.com${PANDUAN_PATH}`;
    document.title = `${title} | JoyoFit`;
    setMeta('meta[name="description"]', "content", description);
    setMeta('link[rel="canonical"]', "href", url);
    setMeta('meta[property="og:url"]', "content", url);
    setMeta('meta[property="og:title"]', "content", title);
    setMeta('meta[property="og:description"]', "content", description);
    setMeta('meta[name="twitter:title"]', "content", title);
    setMeta('meta[name="twitter:description"]', "content", description);
    // The page renders after load, so the browser cannot jump to an anchor on its own.
    const target = window.location.hash ? document.getElementById(window.location.hash.slice(1)) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
  }, []);

  return (
    <section data-section="panduan" className="py-12 md:py-16">
      <div className="mx-auto w-full max-w-3xl px-4 md:px-6">
        <a
          href="/"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Kembali ke beranda
        </a>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
          Panduan pasang dan pakai JoyoFit
        </h1>
        <p className="mt-3 text-muted-foreground">
          Dari pasang aplikasi sampai jam tersambung dan data masuk. Bahasa Indonesia di bawah,{" "}
          <a href="#english" className="font-semibold underline underline-offset-4">English version</a> setelahnya.
        </p>
        <div className="mt-8">
          <Guide lang="id" />
        </div>
        <h2 id="english" className="mt-14 scroll-mt-20 text-2xl font-extrabold tracking-tight md:text-3xl">
          Install and use guide (English)
        </h2>
        <div className="mt-6">
          <Guide lang="en" />
        </div>
      </div>
    </section>
  );
}
