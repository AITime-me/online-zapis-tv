"use client";

import { signOut } from "next-auth/react";

export function LogoutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="rounded border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
    >
      Выйти
    </button>
  );
}
