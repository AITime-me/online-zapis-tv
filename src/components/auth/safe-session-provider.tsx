"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";

type SafeSessionProviderProps = {
  children: React.ReactNode;
  session?: Session | null;
};

export function SafeSessionProvider({
  children,
  session = null,
}: SafeSessionProviderProps) {
  return (
    <SessionProvider
      session={session}
      basePath="/api/auth"
      refetchOnWindowFocus={false}
    >
      {children}
    </SessionProvider>
  );
}
