"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { StudioSettingsDto } from "@/types/studio-settings";

type SaveStatus = "idle" | "saving" | "saved" | "error";

const fieldClass =
  "w-full rounded border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900";
const labelClass = "text-xs font-medium text-zinc-700";
const sectionClass = "space-y-4 rounded border border-zinc-200 bg-zinc-50 p-4";
const sectionTitleClass = "text-sm font-semibold text-zinc-900";

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={sectionClass}>
      <h3 className={sectionTitleClass}>{title}</h3>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

export function StudioSettingsPanel({
  initialSettings,
}: {
  initialSettings: StudioSettingsDto;
}) {
  const [settings, setSettings] = useState<StudioSettingsDto>(initialSettings);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setSettings(initialSettings);
  }, [initialSettings]);

  const statusLabel =
    status === "saving"
      ? "Сохраняю..."
      : status === "saved"
        ? "Сохранено"
        : status === "error"
          ? `Ошибка${message ? `: ${message}` : ""}`
          : null;

  const updateField = <K extends keyof StudioSettingsDto>(
    key: K,
    value: StudioSettingsDto[K],
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const saveSettings = async () => {
    setStatus("saving");
    setMessage(null);

    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studioName: settings.studioName,
          legalName: settings.legalName,
          inn: settings.inn,
          ogrnip: settings.ogrnip,
          phone: settings.phone,
          email: settings.email,
          address: settings.address,
          vkUrl: settings.vkUrl,
          maxUrl: settings.maxUrl,
          telegramUrl: settings.telegramUrl,
          whatsappUrl: settings.whatsappUrl,
          workingHoursText: settings.workingHoursText,
          bookingSuccessMessage: settings.bookingSuccessMessage,
          requestSuccessMessage: settings.requestSuccessMessage,
          gameSuccessMessage: settings.gameSuccessMessage,
          privacyUrl: settings.privacyUrl,
          termsUrl: settings.termsUrl,
          consentUrl: settings.consentUrl,
          offerUrl: settings.offerUrl,
          isOnlineBookingEnabled: settings.isOnlineBookingEnabled,
          isGameEnabled: settings.isGameEnabled,
          isPromotionsEnabled: settings.isPromotionsEnabled,
          cookieBannerText: settings.cookieBannerText,
          cookieDetailsUrl: settings.cookieDetailsUrl,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok || !payload.settings) {
        throw new Error(payload.error ?? "Ошибка сохранения");
      }
      setSettings(payload.settings);
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1500);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка сохранения";
      setStatus("error");
      setMessage(text);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-zinc-200 bg-white p-4">
        <p className="text-sm text-zinc-600">
          Изменения применяются после сохранения. Публичные данные доступны через{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">/api/settings/public</code>.
        </p>
        <div className="flex items-center gap-3">
          {statusLabel ? (
            <span className="text-sm text-zinc-500">{statusLabel}</span>
          ) : null}
          <button
            type="button"
            onClick={saveSettings}
            disabled={status === "saving"}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            Сохранить
          </button>
        </div>
      </div>

      <SettingsSection title="1. Основные данные студии">
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className={labelClass}>Название студии</span>
          <input
            value={settings.studioName}
            onChange={(event) => updateField("studioName", event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className={labelClass}>Юридическое имя</span>
          <input
            value={settings.legalName}
            onChange={(event) => updateField("legalName", event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>ИНН</span>
          <input
            value={settings.inn}
            onChange={(event) => updateField("inn", event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>ОГРНИП</span>
          <input
            value={settings.ogrnip}
            onChange={(event) => updateField("ogrnip", event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Телефон</span>
          <input
            value={settings.phone}
            onChange={(event) => updateField("phone", event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Email</span>
          <input
            type="email"
            value={settings.email}
            onChange={(event) => updateField("email", event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className={labelClass}>Адрес</span>
          <input
            value={settings.address}
            onChange={(event) => updateField("address", event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className={labelClass}>Режим работы (текстом)</span>
          <textarea
            value={settings.workingHoursText}
            onChange={(event) => updateField("workingHoursText", event.target.value)}
            rows={3}
            placeholder="Например: Пн–Пт 09:00–18:00, Сб–Вс 10:00–18:00"
            className={fieldClass}
          />
        </label>
      </SettingsSection>

      <SettingsSection title="2. Каналы связи">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>VK</span>
          <input
            value={settings.vkUrl}
            onChange={(event) => updateField("vkUrl", event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>MAX</span>
          <input
            value={settings.maxUrl}
            onChange={(event) => updateField("maxUrl", event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Telegram</span>
          <input
            value={settings.telegramUrl}
            onChange={(event) => updateField("telegramUrl", event.target.value)}
            placeholder="https://t.me/..."
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>WhatsApp</span>
          <input
            value={settings.whatsappUrl}
            onChange={(event) => updateField("whatsappUrl", event.target.value)}
            placeholder="https://wa.me/..."
            className={fieldClass}
          />
        </label>
        <p className="text-xs leading-relaxed text-zinc-500 md:col-span-2">
          Эти ссылки используются в кнопках связи, заявках, игре и будущих
          интеграциях.
        </p>
      </SettingsSection>

      <SettingsSection title="3. Юридические ссылки">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Политика конфиденциальности</span>
          <input
            value={settings.privacyUrl}
            onChange={(event) => updateField("privacyUrl", event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Пользовательское соглашение</span>
          <input
            value={settings.offerUrl}
            onChange={(event) => updateField("offerUrl", event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Согласие на обработку персональных данных</span>
          <input
            value={settings.consentUrl}
            onChange={(event) => updateField("consentUrl", event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Публичная оферта</span>
          <input
            value={settings.termsUrl}
            onChange={(event) => updateField("termsUrl", event.target.value)}
            className={fieldClass}
          />
        </label>
      </SettingsSection>

      <SettingsSection title="4. Тексты после отправки заявок">
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className={labelClass}>Сообщение после онлайн-записи</span>
          <textarea
            value={settings.bookingSuccessMessage}
            onChange={(event) =>
              updateField("bookingSuccessMessage", event.target.value)
            }
            rows={3}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className={labelClass}>Сообщение после заявки через менеджера</span>
          <textarea
            value={settings.requestSuccessMessage}
            onChange={(event) =>
              updateField("requestSuccessMessage", event.target.value)
            }
            rows={3}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className={labelClass}>Сообщение после заявки из игры</span>
          <textarea
            value={settings.gameSuccessMessage}
            onChange={(event) =>
              updateField("gameSuccessMessage", event.target.value)
            }
            rows={3}
            className={fieldClass}
          />
        </label>
      </SettingsSection>

      <section className={sectionClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className={sectionTitleClass}>Юридические документы</h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              Редактирование текстов для /privacy, /terms, /consent, /offer и /cookies.
            </p>
          </div>
          <Link
            href="/admin/settings/legal"
            className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100"
          >
            Открыть редактор
          </Link>
        </div>
      </section>

      <SettingsSection title="5. Системные переключатели">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="flex items-start gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={settings.isOnlineBookingEnabled}
              onChange={(event) =>
                updateField("isOnlineBookingEnabled", event.target.checked)
              }
              className="mt-0.5"
            />
            <span>Онлайн-запись включена</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={settings.isGameEnabled}
              onChange={(event) => updateField("isGameEnabled", event.target.checked)}
              className="mt-0.5"
            />
            <span>Игра включена</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={settings.isPromotionsEnabled}
              onChange={(event) =>
                updateField("isPromotionsEnabled", event.target.checked)
              }
              className="mt-0.5"
            />
            <span>Акции включены</span>
          </label>
        </div>
        <p className="text-xs leading-relaxed text-zinc-500 md:col-span-2">
          Переключатели сохраняются в настройках. Подключение к публичным страницам
          выполняется постепенно; игра уже учитывает флаг «Игра включена».
        </p>
      </SettingsSection>

      <SettingsSection title="6. Cookie-плашка">
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className={labelClass}>Текст cookie-плашки</span>
          <textarea
            value={settings.cookieBannerText}
            onChange={(event) => updateField("cookieBannerText", event.target.value)}
            rows={3}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className={labelClass}>Ссылка «Подробнее»</span>
          <input
            value={settings.cookieDetailsUrl}
            onChange={(event) => updateField("cookieDetailsUrl", event.target.value)}
            className={fieldClass}
          />
        </label>
        <p className="text-xs leading-relaxed text-zinc-500 md:col-span-2">
          Плашка показывается на публичных страницах до нажатия «Понятно».
        </p>
      </SettingsSection>
    </div>
  );
}
