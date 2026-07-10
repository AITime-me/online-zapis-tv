import { redirect } from "next/navigation";
import { requireAdminSection } from "@/lib/auth/session";
import { ensureLegacyCatchTimeGameCatalog } from "@/services/GameCatalogService";

export default async function LegacyGameAdminRedirectPage() {
  await requireAdminSection("game");
  const game = await ensureLegacyCatchTimeGameCatalog();
  redirect(`/admin/games/${game.id}`);
}
