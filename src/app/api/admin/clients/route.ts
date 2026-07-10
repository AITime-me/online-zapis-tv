import { NextResponse } from "next/server";
import { CLIENTS_ADMIN_ROLES, requireApiRoles } from "@/lib/auth/api-access";
import {
  clientAdminErrorResponse,
  readClientAdminWriteBody,
} from "@/lib/api/client-admin-route";
import {
  archiveClientForAdmin,
  createClientForAdmin,
  listClientsForAdminPaginated,
  restoreClientForAdmin,
  updateClientForAdmin,
} from "@/services/ClientAdminService";
import { parseClientListQuery } from "@/lib/clients/list-query";
import type { ClientAdminCreateInput } from "@/types/client-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const authResult = await requireApiRoles(CLIENTS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const { searchParams } = new URL(request.url);
    const query = parseClientListQuery(searchParams);
    const result = await listClientsForAdminPaginated(query);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return clientAdminErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const authResult = await requireApiRoles(CLIENTS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const body = (await request.json()) as ClientAdminCreateInput;
    const client = await createClientForAdmin(body);
    return NextResponse.json({ ok: true, client }, { status: 201 });
  } catch (error) {
    return clientAdminErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const authResult = await requireApiRoles(CLIENTS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const body = await readClientAdminWriteBody(request);
  if (body instanceof NextResponse) {
    return body;
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Не указан id клиента" },
      { status: 400 },
    );
  }

  const { id: _id, archive, restore, ...input } = body;

  try {
    if (archive === true) {
      const client = await archiveClientForAdmin(id);
      return NextResponse.json({ ok: true, client });
    }
    if (restore === true) {
      const client = await restoreClientForAdmin(id);
      return NextResponse.json({ ok: true, client });
    }

    const client = await updateClientForAdmin(id, input);
    return NextResponse.json({ ok: true, client });
  } catch (error) {
    return clientAdminErrorResponse(error);
  }
}
