"use client";

import { SafeSessionProvider } from "@/components/auth/safe-session-provider";

export default function InternalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SafeSessionProvider>{children}</SafeSessionProvider>;
}
