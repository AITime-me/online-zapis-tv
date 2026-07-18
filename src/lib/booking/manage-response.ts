import { NextResponse } from "next/server";

/** Единый ответ при отсутствии/невалидности manage token — без enumeration. */
export const MANAGE_LINK_INVALID_MESSAGE = "Ссылка на запись недействительна";

/** Строгий no-store без s-maxage; итоговый runtime Cache-Control. */
export const MANAGE_CACHE_CONTROL =
  "private, no-store, max-age=0, must-revalidate";

export const MANAGE_SECURITY_HEADERS: HeadersInit = {
  "Cache-Control": MANAGE_CACHE_CONTROL,
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
};

export function applyManageSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", MANAGE_CACHE_CONTROL);
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

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
