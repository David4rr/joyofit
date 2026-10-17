import type { AppEnv } from "../env";

export const DISCLAIMER =
  "Ini bukan pantauan langsung. Data baru masuk setelah jam tersinkron ke ponsel dan ponselnya terhubung internet, jadi bisa telat dari beberapa menit sampai berjam-jam. JoyoFit bukan alat darurat dan tidak mendeteksi jatuh, serangan jantung, atau kondisi gawat. Kalau kamu khawatir, telepon langsung atau hubungi layanan darurat (112).";

export interface PushMessage {
  title: string;
  body: string;
  data: Record<string, string>;
}

const EXPO_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Sends one notification to every Expo token through the Expo Push Service. Returns how many were accepted and the
 * tokens Expo says are dead (`DeviceNotRegistered`), which the caller deletes. Never throws.
 */
export async function sendExpoPush(env: AppEnv, tokens: string[], message: PushMessage): Promise<{ delivered: number; dead: string[] }> {
  if (tokens.length === 0) return { delivered: 0, dead: [] };
  try {
    const response = await fetch(env.EXPO_PUSH_URL || EXPO_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(tokens.map((to) => ({ to, title: message.title, body: message.body, data: message.data, sound: "default", priority: "high", channelId: "family" }))),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      console.error(JSON.stringify({ event: "family_push_failed", status: response.status }));
      return { delivered: 0, dead: [] };
    }
    const json = (await response.json()) as { data?: { status?: string; details?: { error?: string } }[] };
    let delivered = 0;
    const dead: string[] = [];
    (json.data ?? []).forEach((ticket, i) => {
      if (ticket.status === "ok") delivered += 1;
      else if (ticket.details?.error === "DeviceNotRegistered" && tokens[i]) dead.push(tokens[i]);
    });
    return { delivered, dead };
  } catch (error) {
    console.error(JSON.stringify({ event: "family_push_error", message: error instanceof Error ? error.message : String(error) }));
    return { delivered: 0, dead: [] };
  }
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

/** Sends one email through the Email binding. False when email is not configured or the send failed. Never throws. */
export async function sendFamilyEmail(env: AppEnv, to: string, subject: string, lines: string[]): Promise<boolean> {
  if (!env.EMAIL || !env.EMAIL_FROM) return false;
  const text = `${lines.join("\n\n")}\n\n${DISCLAIMER}\n\nJoyoFit`;
  const html = `<!doctype html><html lang="id"><body style="margin:0;padding:24px 12px;background:#f3f4f6;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1f2937;"><div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px 24px;"><p style="margin:0 0 16px;font-size:15px;font-weight:700;color:#16a34a;">JoyoFit</p><h1 style="margin:0 0 16px;font-size:19px;line-height:1.4;">${escapeHtml(subject)}</h1>${lines
    .map((line) => `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;">${escapeHtml(line)}</p>`)
    .join("")}<p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#6b7280;">${escapeHtml(DISCLAIMER)}</p></div></body></html>`;
  try {
    await env.EMAIL.send({ to, from: { email: env.EMAIL_FROM, name: env.EMAIL_FROM_NAME || "JoyoFit" }, subject, html, text });
    return true;
  } catch (error) {
    console.error(JSON.stringify({ event: "family_email_failed", message: error instanceof Error ? error.message : String(error) }));
    return false;
  }
}
