import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Flame,
  Footprints,
  Gauge,
  HeartPulse,
  Info,
  LoaderCircle,
  Mail,
  Route,
  Send,
  Smartphone,
  Timer,
  type LucideIcon,
} from "lucide-react";

import { CONTACT_EMAIL, IPHONE_PATH, STRAVA_PATH, WAITLIST_API, cn, goal, setMeta } from "./lib";
import { PRIVASI_PATH } from "./Privasi";

type Kind = "strava" | "iphone";

function usePageMeta(path: string, title: string, description: string) {
  useEffect(() => {
    const url = `https://fit.joyorogo.com${path}`;
    document.title = `${title} | JoyoFit`;
    setMeta('meta[name="description"]', "content", description);
    setMeta('link[rel="canonical"]', "href", url);
    setMeta('meta[property="og:url"]', "content", url);
    setMeta('meta[property="og:title"]', "content", title);
    setMeta('meta[property="og:description"]', "content", description);
    setMeta('meta[name="twitter:title"]', "content", title);
    setMeta('meta[name="twitter:description"]', "content", description);
    window.scrollTo(0, 0);
  }, [path, title, description]);
}

const inputClass =
  "block h-12 w-full rounded-xl border border-input bg-background px-4 text-base text-foreground placeholder:text-muted-foreground/70 outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-60";

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-bold">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="mt-0.5 text-sm leading-snug text-muted-foreground">
          {hint}
        </p>
      )}
      <div className="mt-2">{children}</div>
    </div>
  );
}

type State = { phase: "idle" } | { phase: "sending" } | { phase: "done" } | { phase: "error"; message: string };

const TRACK_EVENT: Record<Kind, string> = { strava: "waitlist_strava_joined", iphone: "waitlist_iphone_joined" };

function errorMessage(status: number): string {
  if (status === 429) return "Terlalu banyak kiriman dari jaringanmu. Coba lagi dalam satu jam.";
  if (status === 400) return "Isian belum valid. Cek lagi email dan kolom lainnya.";
  return `Belum terkirim. Coba lagi sebentar lagi, atau kirim email ke ${CONTACT_EMAIL}.`;
}

function WaitlistForm({ kind }: { kind: Kind }) {
  const [state, setState] = useState<State>({ phase: "idle" });
  const strava = kind === "strava";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.phase === "sending") return;
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    setState({ phase: "sending" });
    try {
      const res = await fetch(WAITLIST_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          email: text("email"),
          stravaProfile: strava ? text("stravaProfile") : undefined,
          watchModel: strava ? undefined : text("watchModel") || undefined,
          website: text("website"),
        }),
      });
      if (!res.ok) {
        setState({ phase: "error", message: errorMessage(res.status) });
        return;
      }
      // A named event with no properties: the address and profile stay out of analytics.
      (window as unknown as { klikapa?: { track?: (name: string) => void } }).klikapa?.track?.(TRACK_EVENT[kind]);
      setState({ phase: "done" });
    } catch {
      setState({ phase: "error", message: errorMessage(0) });
    }
  }

  if (state.phase === "done") {
    return (
      <div role="status" className="rounded-2xl bg-makan-soft p-5 text-makan-ink">
        <p className="flex items-center gap-2 font-bold">
          <Check className="size-5" aria-hidden />
          Kamu sudah masuk daftar
        </p>
        <p className="mt-1.5 text-[0.9375rem] leading-relaxed">
          {strava
            ? "Kami kabari lewat email begitu ada slot Strava untukmu. Mengirim formulir lagi dengan email yang sama hanya memperbarui isiannya."
            : "Kami tambahkan emailmu sebagai tester TestFlight secara manual, jadi tunggu email dari TestFlight. Mengirim formulir lagi dengan email yang sama hanya memperbarui isiannya."}
        </p>
      </div>
    );
  }

  const sending = state.phase === "sending";
  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate={false}>
      <Field
        id={`${kind}-email`}
        label={strava ? "Email" : "Email Apple ID untuk TestFlight"}
        hint={strava ? "Untuk memberi tahu kamu saat slot tersedia." : "Harus email yang kamu pakai untuk masuk ke App Store di iPhone."}
      >
        <input
          id={`${kind}-email`}
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          inputMode="email"
          placeholder="kamu@contoh.com"
          aria-describedby={`${kind}-email-hint`}
          disabled={sending}
          className={inputClass}
        />
      </Field>
      {strava ? (
        <Field
          id="strava-profile"
          label="Nama atau link profil Strava"
          hint="Contoh: nama di Strava, atau strava.com/athletes/12345. Untuk mencocokkan akunmu saat kami memberi akses."
        >
          <input
            id="strava-profile"
            name="stravaProfile"
            type="text"
            required
            maxLength={200}
            autoComplete="off"
            placeholder="strava.com/athletes/12345"
            aria-describedby="strava-profile-hint"
            disabled={sending}
            className={inputClass}
          />
        </Field>
      ) : (
        <Field id="iphone-watch" label="Model jam (opsional)" hint="Supaya kami tahu jam apa yang paling ingin diuji di iPhone.">
          <input
            id="iphone-watch"
            name="watchModel"
            type="text"
            maxLength={100}
            autoComplete="off"
            placeholder="Huawei Watch Fit 4 Pro"
            aria-describedby="iphone-watch-hint"
            disabled={sending}
            className={inputClass}
          />
        </Field>
      )}
      {/* Honeypot: people never see or reach it; a bot that fills it is dropped by the server. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <button
        type="submit"
        disabled={sending}
        {...goal(strava ? "strava_waitlist_submit_click" : "iphone_waitlist_submit_click", kind)}
        className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-primary px-6 text-base font-semibold text-primary-foreground transition-[background-color,transform] duration-150 hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none active:scale-[0.97] disabled:opacity-70 sm:w-auto"
      >
        {sending ? <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Send className="size-5" aria-hidden />}
        {sending ? "Mengirim" : strava ? "Masuk daftar tunggu Strava" : "Masuk daftar TestFlight"}
      </button>
      <p role="alert" className={cn("flex gap-2 text-sm font-semibold text-destructive", state.phase !== "error" && "hidden")}>
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        {state.phase === "error" ? state.message : null}
      </p>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Yang kami simpan: email{strava ? ", nama atau link profil Strava" : " dan model jam bila kamu isi"}, serta waktu
        pendaftaran. Dipakai hanya untuk undangan ini, tidak dibagikan, dan tidak masuk statistik situs. Hapus kapan saja
        lewat email. Rinciannya di{" "}
        <a href={`${PRIVASI_PATH}#waitlist`} className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80">
          halaman privasi
        </a>
        .
      </p>
    </form>
  );
}

function Steps({ items }: { items: readonly { title: string; body: ReactNode }[] }) {
  return (
    <ol className="space-y-5">
      {items.map((step, i) => (
        <li key={step.title} className="flex gap-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-extrabold text-primary-foreground tabular-nums">
            {i + 1}
          </span>
          <div>
            <p className="font-bold">{step.title}</p>
            <p className="mt-0.5 text-[0.9375rem] leading-relaxed text-muted-foreground">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function BackLink() {
  return (
    <a
      href="/#cara"
      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Kembali ke tiga cara pakai
    </a>
  );
}

function Notes({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div>
      <p className="text-sm font-bold">{title}</p>
      <ul className="mt-2 space-y-2">
        {items.map((line) => (
          <li key={line} className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

const STRAVA_META = {
  title: "JoyoFit ke Strava: daftar undangan",
  description:
    "JoyoFit mengirim olahraga dari jam Huawei ke Strava dengan jarak, waktu aktif, kalori, langkah, detak jantung, dan rute dari jam. Masih lewat undangan sampai Strava menyetujui aplikasinya.",
};

const STRAVA_SENT: { Icon: LucideIcon; label: string }[] = [
  { Icon: Route, label: "Jarak dan rute GPS" },
  { Icon: Timer, label: "Waktu aktif" },
  { Icon: Gauge, label: "Pace" },
  { Icon: Flame, label: "Kalori" },
  { Icon: Footprints, label: "Langkah" },
  { Icon: HeartPulse, label: "Detak jantung" },
];

export function StravaPage() {
  usePageMeta(STRAVA_PATH, STRAVA_META.title, STRAVA_META.description);
  return (
    <section data-section="strava" className="py-12 md:py-16">
      <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
        <BackLink />
        <div className="mt-4 grid gap-4 md:grid-cols-[1.1fr_1fr] md:items-start">
          <div className="rounded-[1.75rem] bg-card p-6 md:p-8">
            <h1 className="text-3xl font-extrabold tracking-tight text-balance md:text-4xl">
              Olahragamu dari jam, langsung ke Strava
            </h1>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
              Setelah tersambung, JoyoFit mengunggah olahraga yang kamu rekam di jam Huawei ke akun Strava-mu sendiri.
              Gratis, dan masih lewat undangan.
            </p>
            <div className="mt-5 rounded-xl bg-white p-3">
              <img
                src="/brand/strava/compatible-with-strava.png"
                width={437}
                height={37}
                alt="Compatible with Strava"
                className="h-auto w-full max-w-[22rem]"
              />
            </div>

            <h2 className="mt-8 text-lg font-extrabold tracking-tight">Yang terkirim</h2>
            <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {STRAVA_SENT.map(({ Icon, label }) => (
                <li key={label} className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2.5 text-sm font-semibold">
                  <Icon className="size-4 shrink-0 text-primary" aria-hidden />
                  {label}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-muted-foreground">
              JoyoFit membuat berkas FIT dari angka yang dicatat jam, bukan perkiraan Strava: total jarak, waktu aktif,
              kalori, jumlah langkah, detak jantung, dan titik rute, termasuk jeda yang dicatat jam. Berkasnya diuji dengan
              membacanya balik memakai SDK FIT resmi Garmin. Strava menghitung waktu bergerak dan pace-nya sendiri dari
              berkas, jadi angka di Strava bisa selisih sedikit dari layar jam.
            </p>

            <h2 className="mt-8 text-lg font-extrabold tracking-tight">Kenapa masih lewat undangan</h2>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
              Menurut dokumentasi Strava, aplikasi API baru dimulai dalam mode satu pemain: hanya akun pemilik aplikasi yang
              bisa masuk. Pemilik bisa menaikkan kapasitasnya menjadi 10 atlet dari dashboard API-nya, dan setelah
              mencapai 10 atlet, aplikasi harus diajukan ke Strava untuk ditinjau (review) sebelum bisa melayani lebih
              banyak orang. Aplikasi Strava JoyoFit masih di tahap terbatas itu, jadi kami membuka akses bertahap: sesuai
              slot yang ada, dan lebih luas setelah Strava menyetujui aplikasinya.
            </p>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
              Kamu bisa mengecek aturan ini sendiri di{" "}
              <a
                href="https://developers.strava.com/docs/getting-started/"
                target="_blank"
                rel="noopener"
                className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
              >
                dokumentasi Strava
              </a>
              . JoyoFit tidak didukung atau disahkan oleh Strava; JoyoFit hanya kompatibel dengan Strava.
            </p>
          </div>

          <div className="space-y-4">
            <div className="rounded-[1.75rem] bg-card p-6 md:p-8">
              <h2 className="text-xl font-extrabold tracking-tight">Cara masuk</h2>
              <div className="mt-5">
                <Steps
                  items={[
                    {
                      title: "Tinggalkan email dan profil Strava",
                      body: "Isi formulir di bawah dengan email dan nama atau link profil Strava-mu.",
                    },
                    {
                      title: "Kami beri akses sesuai kapasitas",
                      body: "Kami mengundang pendaftar bertahap, sesuai slot yang ada, dan lebih banyak setelah Strava menyetujui aplikasinya. Kami kabari lewat email.",
                    },
                    {
                      title: "Sambungkan di JoyoFit",
                      body: (
                        <>
                          Di aplikasi: Pengaturan, Strava, Connect with Strava. Setelah itu olahraga yang selesai kamu
                          rekam terkirim otomatis, dan olahraga lama bisa dikirim dengan tombol Kirim ke Strava.
                        </>
                      ),
                    },
                  ]}
                />
              </div>
            </div>
            <div className="rounded-[1.75rem] bg-card p-6 md:p-8">
              <h2 className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
                <Mail className="size-5 text-primary" aria-hidden />
                Daftar
              </h2>
              <div className="relative mt-5">
                <WaitlistForm kind="strava" />
              </div>
            </div>
            <div className="rounded-[1.75rem] bg-card p-6 md:p-8">
              <Notes
                title="Yang perlu kamu tahu"
                items={[
                  "Daftar ini bukan jaminan slot dalam waktu tertentu; kami mengundang sesuai kapasitas Strava.",
                  "Izin yang diminta hanya satu: mengunggah aktivitas ke akunmu sendiri. JoyoFit tidak membaca data Strava.",
                  "Kamu bisa memutus sambungan kapan saja di aplikasi, atau di strava.com (Pengaturan, Aplikasi Saya).",
                ]}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const IPHONE_META = {
  title: "JoyoFit untuk iPhone: daftar TestFlight",
  description:
    "Aplikasi JoyoFit untuk iPhone masih di TestFlight dan lewat undangan, sambil menunggu beta publik dan review App Store. Daftarkan email Apple ID-mu.",
};

export function IphonePage() {
  usePageMeta(IPHONE_PATH, IPHONE_META.title, IPHONE_META.description);
  return (
    <section data-section="iphone" className="py-12 md:py-16">
      <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
        <BackLink />
        <div className="mt-4 grid gap-4 md:grid-cols-[1.1fr_1fr] md:items-start">
          <div className="rounded-[1.75rem] bg-card p-6 md:p-8">
            <div className="flex gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-muted text-foreground">
                <Smartphone className="size-6" aria-hidden />
              </span>
              <h1 className="text-3xl font-extrabold tracking-tight text-balance md:text-4xl">
                JoyoFit di iPhone, lewat undangan TestFlight
              </h1>
            </div>
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-muted-foreground">
              Aplikasi iPhone-nya sudah ada di TestFlight, tetapi baru dibuka untuk tester yang kami undang satu per satu.
              Beta publik dan review App Store belum selesai, jadi belum ada link yang bisa dibuka siapa saja dan belum
              ada di App Store.
            </p>

            <h2 className="mt-8 text-lg font-extrabold tracking-tight">Batasan yang jujur</h2>
            <div className="mt-3">
              <Notes
                title="Baca dulu sebelum mendaftar"
                items={[
                  "Baru diuji dengan Huawei Watch Fit 4 Pro. Jam lain belum dicoba di iPhone.",
                  "Banyak hal yang kami tulis untuk iPhone baru diuji di komputer dan belum dijalankan di iPhone sungguhan, jadi harapkan ada yang tidak jalan.",
                  "Memasangkan jam ke iPhone menggantikan pairing yang sudah ada, jadi satu jam hanya bisa dipakai di satu HP dalam satu waktu.",
                  "iOS tidak mengizinkan JoyoFit meneruskan notifikasi aplikasi lain, mencari iPhone dari jam, atau mengatur panggilan. Notifikasi dibaca jam langsung dari iPhone lewat pengaturan iOS.",
                  "Beberapa fitur yang ada di Android belum ada di iPhone, seperti siklus, makanan, dan latihan dengan GPS HP. Layar yang belum tersedia mengatakan itu, bukan menampilkan tombol yang gagal.",
                  "Tampilan aplikasinya saat ini berbahasa Inggris.",
                ]}
              />
            </div>
            <p className="mt-6 text-[0.9375rem] leading-relaxed text-muted-foreground">
              Penjelasan fitur iPhone yang sudah dan belum ada ada di{" "}
              <a
                href="https://github.com/dzulfikar08/joyofit/blob/master/docs/ios.md"
                target="_blank"
                rel="noopener"
                className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
              >
                docs/ios.md
              </a>{" "}
              di GitHub.
            </p>
          </div>

          <div className="space-y-4">
            <div className="rounded-[1.75rem] bg-card p-6 md:p-8">
              <h2 className="text-xl font-extrabold tracking-tight">Cara masuk</h2>
              <div className="mt-5">
                <Steps
                  items={[
                    {
                      title: "Kami tambahkan emailmu sebagai tester",
                      body: "Isi email Apple ID yang kamu pakai di iPhone. Kami menambahkannya di App Store Connect secara manual, jadi tidak instan.",
                    },
                    {
                      title: "Kamu terima email dari TestFlight",
                      body: "Email undangannya datang dari Apple (TestFlight) ke alamat yang kamu daftarkan.",
                    },
                    {
                      title: "Pasang TestFlight dan terima undangan",
                      body: "Pasang TestFlight dari App Store bila belum ada, buka undangannya di iPhone, ketuk Terima, lalu Pasang JoyoFit.",
                    },
                  ]}
                />
              </div>
            </div>
            <div className="rounded-[1.75rem] bg-card p-6 md:p-8">
              <h2 className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
                <Mail className="size-5 text-primary" aria-hidden />
                Daftar
              </h2>
              <div className="relative mt-5">
                <WaitlistForm kind="iphone" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
