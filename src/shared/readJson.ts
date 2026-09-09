/** Bound decoded response bytes, including chunked bodies. Never include the
 * response body in an error: authentication responses may contain secrets. */
export async function readJson(
  response: Response,
  maxBytes: number,
  messages: { empty: string; large: string; unreadable: string },
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error(messages.empty);
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new Error(messages.large);
      parts.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const all = new Uint8Array(bytes);
  let offset = 0;
  for (const part of parts) {
    all.set(part, offset);
    offset += part.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(all));
  } catch {
    throw new Error(messages.unreadable);
  }
}
