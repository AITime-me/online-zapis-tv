import { readApiJsonResponse } from "@/lib/api/read-json-response";
import type { ClientAdminDto } from "@/types/client-admin";

type PatchClientTagsResponse = {
  ok?: boolean;
  client?: ClientAdminDto;
  error?: string;
};

export async function patchClientTags(
  clientId: string,
  tags: string[],
): Promise<string[]> {
  const response = await fetch("/api/admin/clients", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: clientId, tags }),
  });

  const payload = await readApiJsonResponse<PatchClientTagsResponse>(response);
  if (!response.ok || !payload.ok || !payload.client) {
    throw new Error(payload.error ?? "Не удалось сохранить теги");
  }

  return payload.client.tags;
}
