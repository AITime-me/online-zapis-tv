import "server-only";

/** Soft body cap for PII-free eligibility JSON (IDs + boolean only). */
export const BOT_INTERNAL_MAX_JSON_BODY_BYTES = 4_096;

export type BoundedJsonReadResult =
  | { ok: true; value: unknown }
  | {
      ok: false;
      code: "PAYLOAD_TOO_LARGE" | "INVALID_JSON";
      error: string;
    };

/**
 * Read and parse JSON with a hard byte limit.
 * Counts actual stream bytes (not JS string length); cancels the reader on overflow.
 * Does not log body contents.
 */
export async function readBoundedJsonBody(
  request: Request,
  maxBytes: number = BOT_INTERNAL_MAX_JSON_BODY_BYTES,
): Promise<BoundedJsonReadResult> {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    return {
      ok: false,
      code: "INVALID_JSON",
      error: "Invalid JSON body",
    };
  }

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader != null && contentLengthHeader.trim() !== "") {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return {
        ok: false,
        code: "PAYLOAD_TOO_LARGE",
        error: "Payload too large",
      };
    }
  }

  if (!request.body) {
    return {
      ok: false,
      code: "INVALID_JSON",
      error: "Invalid JSON body",
    };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.byteLength === 0) {
        continue;
      }

      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Ignore cancel errors after size reject.
        }
        return {
          ok: false,
          code: "PAYLOAD_TOO_LARGE",
          error: "Payload too large",
        };
      }

      chunks.push(value);
    }
  } catch {
    try {
      await reader.cancel();
    } catch {
      // Ignore cancel errors after read failure.
    }
    return {
      ok: false,
      code: "INVALID_JSON",
      error: "Invalid JSON body",
    };
  }

  if (total === 0) {
    return {
      ok: false,
      code: "INVALID_JSON",
      error: "Invalid JSON body",
    };
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(merged);
  } catch {
    return {
      ok: false,
      code: "INVALID_JSON",
      error: "Invalid JSON body",
    };
  }

  if (text.trim() === "") {
    return {
      ok: false,
      code: "INVALID_JSON",
      error: "Invalid JSON body",
    };
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      code: "INVALID_JSON",
      error: "Invalid JSON body",
    };
  }
}
