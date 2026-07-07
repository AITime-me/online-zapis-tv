import { requireAdminSection } from "@/lib/auth/session";
import { AdminPlaceholderPage } from "@/components/admin/admin-placeholder-page";

export default async function GameAdminPage() {
  const user = await requireAdminSection("game");

  return (
    <AdminPlaceholderPage
      title="Игра «Поймай своё время»"
      description="Настройки игры, подарки, вероятности выпадения, тексты и изображения карточек."
      current="game"
      role={user.role}
      notice="Раздел доступен только владельцу. Здесь появятся настройки игры, список подарков, вероятности, тексты, изображения и сезонные кампании."
    />
  );
}
