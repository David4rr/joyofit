import { HTTPException } from "hono/http-exception";

/** Reads and parses a JSON body, refusing more than `max` bytes even when `Content-Length` is missing or wrong. */
export async function readJson(request: Request, max: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw new HTTPException(413, { message: "too_large" });
  const reader = request.body?.getReader();
  if (!reader) throw new HTTPException(400, { message: "empty_body" });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new HTTPException(413, { message: "too_large" });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HTTPException(400, { message: "invalid_json" });
  }
}
