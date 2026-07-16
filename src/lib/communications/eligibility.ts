import type {
  CommConsentStatus,
  CommDeliveryStatus,
} from "@prisma/client";

export type ContactEligibilityInput = {
  deliveryStatus: CommDeliveryStatus;
  consentStatus: CommConsentStatus;
  isUnsubscribed: boolean;
  suppressed?: boolean;
};

/**
 * Контакт доступен для рекламной рассылки только при явном ALLOWED + CONFIRMED
 * и отсутствии отписки/suppression.
 */
export function isEligibleForPromotionalBroadcast(
  contact: ContactEligibilityInput,
): boolean {
  if (contact.suppressed) {
    return false;
  }
  if (contact.isUnsubscribed) {
    return false;
  }
  if (
    contact.deliveryStatus === "DENIED" ||
    contact.deliveryStatus === "BLOCKED"
  ) {
    return false;
  }
  if (contact.deliveryStatus !== "ALLOWED") {
    return false;
  }
  if (contact.consentStatus === "REVOKED") {
    return false;
  }
  if (contact.consentStatus !== "CONFIRMED") {
    return false;
  }
  return true;
}

export function eligibilityBlockReason(
  contact: ContactEligibilityInput,
): string | null {
  if (contact.suppressed) {
    return "suppression";
  }
  if (contact.isUnsubscribed) {
    return "unsubscribed";
  }
  if (contact.deliveryStatus === "BLOCKED") {
    return "blocked";
  }
  if (contact.deliveryStatus === "DENIED") {
    return "denied";
  }
  if (contact.consentStatus === "REVOKED") {
    return "consent_revoked";
  }
  if (contact.consentStatus !== "CONFIRMED") {
    return "consent_not_confirmed";
  }
  if (contact.deliveryStatus !== "ALLOWED") {
    return "delivery_not_allowed";
  }
  return null;
}
