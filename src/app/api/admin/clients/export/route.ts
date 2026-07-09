import { NextResponse } from "next/server";
import { CLIENTS_ADMIN_ROLES, requireApiRoles } from "@/lib/auth/api-access";
import {
  buildClientsExportCsv,
  buildClientsExportFilename,
  listClientsForExport,
  parseClientExportFilters,
} from "@/services/ClientExportService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const authResult = await requireApiRoles(CLIENTS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const { searchParams } = new URL(request.url);
    const filters = parseClientExportFilters(searchParams);
    const clients = await listClientsForExport(filters);
    const csv = buildClientsExportCsv(clients);
    const filename = buildClientsExportFilename();

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Не удалось выгрузить клиентов" },
      { status: 500 },
    );
  }
}
