import { prisma } from "@/lib/db";
import {
  DEFAULT_STUDIO_SETTINGS,
  STUDIO_SETTINGS_ID,
} from "@/lib/studio-settings/defaults";
import type {
  PublicStudioSettingsDto,
  StudioSettingsDto,
  StudioSettingsWriteInput,
} from "@/types/studio-settings";
import type { Prisma, StudioSettings } from "@prisma/client";

export class StudioSettingsValidationError extends Error {}

function mapSettings(row: StudioSettings): StudioSettingsDto {
  return {
    id: row.id,
    studioName: row.studioName,
    legalName: row.legalName,
    inn: row.inn,
    ogrnip: row.ogrnip,
    phone: row.phone,
    email: row.email,
    address: row.address,
    vkUrl: row.vkUrl,
    maxUrl: row.maxUrl,
    telegramUrl: row.telegramUrl,
    whatsappUrl: row.whatsappUrl,
    workingHoursText: row.workingHoursText,
    bookingSuccessMessage: row.bookingSuccessMessage,
    requestSuccessMessage: row.requestSuccessMessage,
    gameSuccessMessage: row.gameSuccessMessage,
    privacyUrl: row.privacyUrl,
    termsUrl: row.termsUrl,
    consentUrl: row.consentUrl,
    offerUrl: row.offerUrl,
    isOnlineBookingEnabled: row.isOnlineBookingEnabled,
    isGameEnabled: row.isGameEnabled,
    isPromotionsEnabled: row.isPromotionsEnabled,
    cookieBannerText: row.cookieBannerText,
    cookieDetailsUrl: row.cookieDetailsUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapPublicSettings(row: StudioSettings): PublicStudioSettingsDto {
  return {
    studioName: row.studioName,
    phone: row.phone,
    email: row.email,
    address: row.address,
    vkUrl: row.vkUrl,
    maxUrl: row.maxUrl,
    workingHoursText: row.workingHoursText,
    privacyUrl: row.privacyUrl,
    termsUrl: row.termsUrl,
    consentUrl: row.consentUrl,
    offerUrl: row.offerUrl,
    isOnlineBookingEnabled: row.isOnlineBookingEnabled,
    isGameEnabled: row.isGameEnabled,
    isPromotionsEnabled: row.isPromotionsEnabled,
    cookieBannerText: row.cookieBannerText,
    cookieDetailsUrl: row.cookieDetailsUrl,
  };
}

function requireNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new StudioSettingsValidationError(`${label} не может быть пустым`);
  }
  return trimmed;
}

function validateOptionalUrl(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("/")) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("invalid");
    }
    return trimmed;
  } catch {
    throw new StudioSettingsValidationError(
      `${label} должна быть ссылкой http(s):// или путём, начинающимся с /`,
    );
  }
}

function validateLegalPath(value: string, label: string): string {
  const validated = validateOptionalUrl(value, label);
  if (!validated.startsWith("/")) {
    throw new StudioSettingsValidationError(`${label} должна начинаться с /`);
  }
  return validated;
}

function validateEmail(value: string): string {
  const trimmed = requireNonEmpty(value, "Email");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new StudioSettingsValidationError("Укажите корректный email");
  }
  return trimmed;
}

export async function ensureStudioSettings(): Promise<StudioSettings> {
  return prisma.studioSettings.upsert({
    where: { id: STUDIO_SETTINGS_ID },
    update: {},
    create: {
      ...DEFAULT_STUDIO_SETTINGS,
    },
  });
}

export async function getStudioSettings(): Promise<StudioSettingsDto> {
  const row = await ensureStudioSettings();
  return mapSettings(row);
}

export async function getPublicStudioSettings(): Promise<PublicStudioSettingsDto> {
  const row = await ensureStudioSettings();
  return mapPublicSettings(row);
}

export async function updateStudioSettings(
  input: StudioSettingsWriteInput,
): Promise<StudioSettingsDto> {
  await ensureStudioSettings();

  const data: Prisma.StudioSettingsUpdateInput = {};

  if (input.studioName !== undefined) {
    data.studioName = requireNonEmpty(input.studioName, "Название студии");
  }
  if (input.legalName !== undefined) {
    data.legalName = requireNonEmpty(input.legalName, "Юридическое имя");
  }
  if (input.inn !== undefined) {
    data.inn = requireNonEmpty(input.inn, "ИНН");
  }
  if (input.ogrnip !== undefined) {
    data.ogrnip = requireNonEmpty(input.ogrnip, "ОГРНИП");
  }
  if (input.phone !== undefined) {
    data.phone = requireNonEmpty(input.phone, "Телефон");
  }
  if (input.email !== undefined) {
    data.email = validateEmail(input.email);
  }
  if (input.address !== undefined) {
    data.address = requireNonEmpty(input.address, "Адрес");
  }
  if (input.vkUrl !== undefined) {
    data.vkUrl = validateOptionalUrl(input.vkUrl, "Ссылка VK");
  }
  if (input.maxUrl !== undefined) {
    data.maxUrl = validateOptionalUrl(input.maxUrl, "Ссылка MAX");
  }
  if (input.telegramUrl !== undefined) {
    data.telegramUrl = validateOptionalUrl(input.telegramUrl, "Ссылка Telegram");
  }
  if (input.whatsappUrl !== undefined) {
    data.whatsappUrl = validateOptionalUrl(input.whatsappUrl, "Ссылка WhatsApp");
  }
  if (input.workingHoursText !== undefined) {
    data.workingHoursText = input.workingHoursText.trim();
  }
  if (input.bookingSuccessMessage !== undefined) {
    data.bookingSuccessMessage = requireNonEmpty(
      input.bookingSuccessMessage,
      "Сообщение после онлайн-записи",
    );
  }
  if (input.requestSuccessMessage !== undefined) {
    data.requestSuccessMessage = requireNonEmpty(
      input.requestSuccessMessage,
      "Сообщение после заявки",
    );
  }
  if (input.gameSuccessMessage !== undefined) {
    data.gameSuccessMessage = requireNonEmpty(
      input.gameSuccessMessage,
      "Сообщение после игры",
    );
  }
  if (input.privacyUrl !== undefined) {
    data.privacyUrl = validateLegalPath(input.privacyUrl, "Политика конфиденциальности");
  }
  if (input.termsUrl !== undefined) {
    data.termsUrl = validateLegalPath(input.termsUrl, "Публичная оферта");
  }
  if (input.consentUrl !== undefined) {
    data.consentUrl = validateLegalPath(
      input.consentUrl,
      "Согласие на обработку данных",
    );
  }
  if (input.offerUrl !== undefined) {
    data.offerUrl = validateLegalPath(input.offerUrl, "Пользовательское соглашение");
  }
  if (input.isOnlineBookingEnabled !== undefined) {
    data.isOnlineBookingEnabled = input.isOnlineBookingEnabled;
  }
  if (input.isGameEnabled !== undefined) {
    data.isGameEnabled = input.isGameEnabled;
  }
  if (input.isPromotionsEnabled !== undefined) {
    data.isPromotionsEnabled = input.isPromotionsEnabled;
  }
  if (input.cookieBannerText !== undefined) {
    data.cookieBannerText = requireNonEmpty(
      input.cookieBannerText,
      "Текст cookie-плашки",
    );
  }
  if (input.cookieDetailsUrl !== undefined) {
    data.cookieDetailsUrl = validateLegalPath(
      input.cookieDetailsUrl,
      "Ссылка на политику cookie",
    );
  }

  const updated = await prisma.studioSettings.update({
    where: { id: STUDIO_SETTINGS_ID },
    data,
  });

  return mapSettings(updated);
}

export function getStudioSettingsSeedData() {
  return { ...DEFAULT_STUDIO_SETTINGS };
}
