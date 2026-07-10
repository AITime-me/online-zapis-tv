import type { BotEventLevel } from "@/lib/bot-settings/event-log";

export type BotEventLogDto = {
  id: string;
  level: BotEventLevel;
  levelLabel: string;
  type: string;
  typeLabel: string;
  channel: string | null;
  title: string;
  message: string | null;
  clientId: string | null;
  bookingRequestId: string | null;
  createdAt: string;
};
