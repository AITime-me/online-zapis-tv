"use client";

import Link from "next/link";
import { useState } from "react";
import { PASSWORD_RESET_NEUTRAL_MESSAGE } from "@/lib/auth/password-reset";

export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        setError("Не удалось отправить запрос. Попробуйте позже.");
        setLoading(false);
        return;
      }

      setSubmitted(true);
    } catch {
      setError("Не удалось отправить запрос. Попробуйте позже.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-semibold">Восстановление пароля</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Укажите email — мы отправим инструкцию, если аккаунт существует.
        </p>
      </div>

      {submitted ? (
        <div className="w-full max-w-sm rounded border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
          {PASSWORD_RESET_NEUTRAL_MESSAGE}
        </div>
      ) : (
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
              autoComplete="email"
              className="rounded border border-zinc-300 px-3 py-2"
            />
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-60"
          >
            {loading ? "Отправка..." : "Отправить инструкцию"}
          </button>
        </form>
      )}

      <Link href="/login" className="text-sm text-zinc-600 underline-offset-2 hover:underline">
        Назад ко входу
      </Link>
    </main>
  );
}
