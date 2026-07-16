/**
 * Граница транспорта доставки сообщений. UI/API не зависят от VK SDK.
 */

export type DeliveryProviderReadiness = {
  ready: boolean;
  supportsButtons: boolean;
  supportsImages: boolean;
  supportsTestSend: boolean;
  reason: string;
};

export type DeliveryMessagePayload = {
  campaignId: string;
  contactId: string;
  messageText: string;
  imageAssetId?: string | null;
  buttons: Array<{
    text: string;
    type: string;
    buttonKey: string;
    action?: string | null;
    url?: string | null;
    style: string;
  }>;
  isTest: boolean;
};

export type DeliveryResult =
  | {
      ok: true;
      externalMessageId: string;
      provider: string;
    }
  | {
      ok: false;
      provider: string;
      errorCode: string;
      errorMessage: string;
    };

export interface CommunicationDeliveryProvider {
  readonly id: string;
  getReadiness(): DeliveryProviderReadiness;
  sendTestMessage(payload: DeliveryMessagePayload): Promise<DeliveryResult>;
  sendMessage(payload: DeliveryMessagePayload): Promise<DeliveryResult>;
}

export const VK_CONNECTOR_NOT_READY = "VK_CONNECTOR_NOT_READY";

export class DisabledCommunicationDeliveryProvider
  implements CommunicationDeliveryProvider
{
  readonly id = "disabled";

  getReadiness(): DeliveryProviderReadiness {
    return {
      ready: false,
      supportsButtons: true,
      supportsImages: true,
      supportsTestSend: false,
      reason: "VK не подключён. Реальная отправка сообщений недоступна.",
    };
  }

  async sendTestMessage(
    _payload: DeliveryMessagePayload,
  ): Promise<DeliveryResult> {
    return {
      ok: false,
      provider: this.id,
      errorCode: VK_CONNECTOR_NOT_READY,
      errorMessage: "Тестовая отправка недоступна: VK-коннектор не готов.",
    };
  }

  async sendMessage(_payload: DeliveryMessagePayload): Promise<DeliveryResult> {
    return {
      ok: false,
      provider: this.id,
      errorCode: VK_CONNECTOR_NOT_READY,
      errorMessage: "Отправка недоступна: VK-коннектор не готов.",
    };
  }
}

let activeProvider: CommunicationDeliveryProvider =
  new DisabledCommunicationDeliveryProvider();

export function getCommunicationDeliveryProvider(): CommunicationDeliveryProvider {
  return activeProvider;
}

/** Только для тестов — не вызывать из продакшен-кода. */
export function __setCommunicationDeliveryProviderForTests(
  provider: CommunicationDeliveryProvider,
): void {
  activeProvider = provider;
}

export function resetCommunicationDeliveryProvider(): void {
  activeProvider = new DisabledCommunicationDeliveryProvider();
}
