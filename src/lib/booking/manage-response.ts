import { NextResponse } from "next/server";

/** Единый ответ при отсутствии/невалидности manage token — без enumeration. */
export const MANAGE_LINK_INVALID_MESSAGE = "Ссылка на запись недействительна";

export const MANAGE_SECURITY_HEADERS: HeadersInit = {
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
};

export function manageJsonResponse(
  body: unknown,
  init?: { status?: number },
): NextResponse {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: MANAGE_SECURITY_HEADERS,
  });
}

export function manageUnauthorizedResponse(): NextResponse {
  return manageJsonResponse(
    {
      ok: false as const,
      error: MANAGE_LINK_INVALID_MESSAGE,
    },
    { status: 404 },
  );
}
