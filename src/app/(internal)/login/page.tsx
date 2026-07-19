"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { resolveSafeInternalCallbackUrl } from "@/lib/auth/safe-callback-url";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = resolveSafeInternalCallbackUrl(
    searchParams.get("callbackUrl"),
  );

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Неверный email или пароль");
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          className="rounded border border-zinc-300 px-3 py-2"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium">
          Пароль
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="rounded border border-zinc-300 px-3 py-2"
        />
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={loading}
        className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-60"
      >
        {loading ? "Вход..." : "Войти"}
      </button>

      <p className="text-center text-sm">
        <Link href="/forgot-password" className="text-zinc-600 underline-offset-2 hover:underline">
          Забыли пароль?
        </Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Вход</h1>
        <p className="mt-2 text-sm text-zinc-600">Внутренняя зона «Твоё время»</p>
      </div>

      <Suspense fallback={<p className="text-sm text-zinc-500">Загрузка...</p>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
