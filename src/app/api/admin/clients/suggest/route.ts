import { NextResponse } from "next/server";
import {
  CLIENTS_ADMIN_ROLES,
  requireApiRoles,
} from "@/lib/auth/api-access";
import { suggestClientsForAppointmentForm } from "@/services/AppointmentClientLinkService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const authResult = await requireApiRoles(CLIENTS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const modeRaw = (searchParams.get("mode") ?? "").trim();
  const mode = modeRaw === "phone" ? "phone" : modeRaw === "name" ? "name" : null;

  if (!mode) {
    return NextResponse.json(
      { ok: false, error: "Укажите mode=name или mode=phone" },
      { status: 400 },
    );
  }

  if (mode === "name" && q.length < 2) {
    return NextResponse.json({ ok: true, clients: [] });
  }

  if (mode === "phone" && q.replace(/\D/g, "").length < 4) {
    return NextResponse.json({ ok: true, clients: [] });
  }

  const clients = await suggestClientsForAppointmentForm({ q, mode, limit: 8 });
  return NextResponse.json({ ok: true, clients });
}
