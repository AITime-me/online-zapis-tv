import type { Metadata } from "next";
import { HomePage } from "@/components/home/home-page";

export const metadata: Metadata = {
  title: "Твоё время — студия красоты",
  description:
    "Онлайн-запись в студию красоты «Твоё время». Выберите процедуру, специалиста и удобное время для визита.",
};

export default function Home() {
  return <HomePage />;
}
