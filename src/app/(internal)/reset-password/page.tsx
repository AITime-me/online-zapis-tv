"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

type ResetState = "form" | "success" | "invalid" | "expired" | "used";

type ResetErrorCode = "invalid" | "expired" | "used" | "policy" | "mismatch";

type TokenCapture = {
  token: string;
  initialState: ResetState;
};

function mapErrorCodeToState(code: ResetErrorCode | undefined): ResetState {
  switch (code) {
    case "expired":
      return "expired";
    case "used":
      return "used";
    case "invalid":
      return "invalid";
    default:
      return "form";
  }
}

function captureTokenFromFragment(): TokenCapture {
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const rawToken = params.get("token")?.trim() ?? "";
  return {
    token: rawToken,
    initialState: rawToken ? "form" : "invalid",
  };
}

let cachedFragmentCapture: TokenCapture | null = null;

function readFragmentCaptureOnce(): TokenCapture | null {
  if (typeof window === "undefined") {
    return null;
  }

  if (!cachedFragmentCapture) {
    cachedFragmentCapture = captureTokenFromFragment();
    window.history.replaceState(null, "", "/reset-password");
  }

  return cachedFragmentCapture;
}

function subscribeToFragmentCapture() {
  return () => {};
}

function ResetPasswordFormInner({ capture }: { capture: TokenCapture }) {
  const [token] = useState(capture.token);
  const [state, setState] = useState<ResetState>(capture.initialState);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const passwordConfirmation = String(formData.get("passwordConfirmation") ?? "");

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, passwordConfirmation }),
      });

      const data = (await response.json()) as {
        ok?: boolean;
        code?: ResetErrorCode;
        error?: string;
      };

      if (data.ok) {
        setState("success");
        setLoading(false);
        return;
      }

      const nextState = mapErrorCodeToState(data.code);
      if (nextState !== "form") {
        setState(nextState);
        setLoading(false);
        return;
      }

      setError(data.error ?? "Не удалось сменить пароль.");
    } catch {
      setError("Не удалось сменить пароль. Попробуйте позже.");
    } finally {
      setLoading(false);
    }
  }

  if (state === "success") {
    return (
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <p className="text-sm text-zinc-700">Пароль успешно изменён.</p>
        <Link
          href="/login"
          className="rounded bg-zinc-900 px-4 py-2 text-sm text-white"
        >
          Перейти ко входу
        </Link>
      </div>
    );
  }

  if (state === "invalid") {
    return (
      <div className="w-full max-w-sm text-center text-sm text-zinc-700">
        Ссылка недействительна.
        <div className="mt-4">
          <Link href="/forgot-password" className="text-zinc-600 underline-offset-2 hover:underline">
            Запросить новую ссылку
          </Link>
        </div>
      </div>
    );
  }

  if (state === "expired") {
    return (
      <div className="w-full max-w-sm text-center text-sm text-zinc-700">
        Ссылка истекла.
        <div className="mt-4">
          <Link href="/forgot-password" className="text-zinc-600 underline-offset-2 hover:underline">
            Запросить новую ссылку
          </Link>
        </div>
      </div>
    );
  }

  if (state === "used") {
    return (
      <div className="w-full max-w-sm text-center text-sm text-zinc-700">
        Ссылка уже использована.
        <div className="mt-4">
          <Link href="/login" className="text-zinc-600 underline-offset-2 hover:underline">
            Перейти ко входу
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium">
          Новый пароль
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          className="rounded border border-zinc-300 px-3 py-2"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="passwordConfirmation" className="text-sm font-medium">
          Повторите пароль
        </label>
        <input
          id="passwordConfirmation"
          name="passwordConfirmation"
          type="password"
          required
          autoComplete="new-password"
          className="rounded border border-zinc-300 px-3 py-2"
        />
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={loading}
        className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-60"
      >
        {loading ? "Сохранение..." : "Сменить пароль"}
      </button>
    </form>
  );
}

function ResetPasswordForm() {
  const capture = useSyncExternalStore(
    subscribeToFragmentCapture,
    readFragmentCaptureOnce,
    () => null,
  );

  if (!capture) {
    return <p className="text-sm text-zinc-500">Загрузка...</p>;
  }

  return <ResetPasswordFormInner capture={capture} />;
}

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Новый пароль</h1>
        <p className="mt-2 text-sm text-zinc-600">Задайте новый пароль для входа</p>
      </div>

      <ResetPasswordForm />

      <Link href="/login" className="text-sm text-zinc-600 underline-offset-2 hover:underline">
        Назад ко входу
      </Link>
    </main>
  );
}
