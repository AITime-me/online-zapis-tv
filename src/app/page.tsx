import type { Metadata } from "next";
import { HomePage } from "@/components/home/home-page";
import { getHomePromotions } from "@/services/HomePromotionsService";

export const metadata: Metadata = {
  title: "Твоё время — студия красоты",
  description:
    "Онлайн-запись в студию красоты «Твоё время». Выберите процедуру, специалиста и удобное время для визита.",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const promotions = await getHomePromotions();
  return <HomePage promotions={promotions} />;
}
