"use client";

import { SessionProvider } from "next-auth/react";

export default function InternalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SessionProvider>{children}</SessionProvider>;
}
