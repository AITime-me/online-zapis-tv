import { NextResponse } from "next/server";
import { EMPTY_CLIENT_CONTEXT, toPublicClientContext } from "@/lib/client/client-context-engine";
import { resolvePublicClientContextByPhone } from "@/services/ClientContextService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ClientContextBody = {
  phone?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ClientContextBody;
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";

    if (!phone) {
      return NextResponse.json({
        ok: true,
        context: toPublicClientContext(EMPTY_CLIENT_CONTEXT),
      });
    }

    const context = await resolvePublicClientContextByPhone(phone);

    return NextResponse.json({
      ok: true,
      context,
    });
  } catch {
    return NextResponse.json({
      ok: true,
      context: toPublicClientContext(EMPTY_CLIENT_CONTEXT),
    });
  }
}
