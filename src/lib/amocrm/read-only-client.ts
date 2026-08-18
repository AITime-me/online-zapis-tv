import "server-only";

/** Server-only amoCRM / Kommo OAuth adapter for Neo analytics. No CRM mutation operation is exposed. */
const ALLOWED_RESOURCES = {
  account: "/api/v4/account",
  leads: "/api/v4/leads",
  contacts: "/api/v4/contacts",
  companies: "/api/v4/companies",
  users: "/api/v4/users",
  pipelines: "/api/v4/leads/pipelines",
} as const;

export type AmoCrmReadResource = keyof typeof ALLOWED_RESOURCES;
export class AmoCrmConfigurationError extends Error {}
export class AmoCrmRequestError extends Error {}

type OAuthTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
};
type AmoCrmConfig = {
  baseUrl: URL;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken: string;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new AmoCrmConfigurationError(`${name} is not configured`);
  return value;
}

function config(): AmoCrmConfig {
  const baseUrl = new URL(required("AMOCRM_BASE_URL"));
  if (
    baseUrl.protocol !== "https:" ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.pathname !== "/"
  ) {
    throw new AmoCrmConfigurationError(
      "AMOCRM_BASE_URL must be an HTTPS origin without a path",
    );
  }
  const redirectUri = new URL(required("AMOCRM_REDIRECT_URI"));
  if (redirectUri.protocol !== "https:")
    throw new AmoCrmConfigurationError("AMOCRM_REDIRECT_URI must use HTTPS");
  return {
    baseUrl,
    clientId: required("AMOCRM_CLIENT_ID"),
    clientSecret: required("AMOCRM_CLIENT_SECRET"),
    redirectUri: redirectUri.toString(),
    refreshToken: required("AMOCRM_REFRESH_TOKEN"),
  };
}

/** OAuth maintenance only. Replacement tokens stay in the host secret store, never in Git or a browser. */
export async function refreshAmoCrmAccessToken(): Promise<{
  accessToken: string;
  replacementRefreshToken: string;
  expiresIn: number;
}> {
  const value = config();
  const response = await fetch(new URL("/oauth2/access_token", value.baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: value.clientId,
      client_secret: value.clientSecret,
      grant_type: "refresh_token",
      refresh_token: value.refreshToken,
      redirect_uri: value.redirectUri,
    }),
    cache: "no-store",
  });
  if (!response.ok)
    throw new AmoCrmRequestError(
      `OAuth token refresh failed (${response.status})`,
    );
  const payload = (await response.json()) as OAuthTokenResponse;
  if (
    typeof payload.token_type !== "string" ||
    payload.token_type.toLowerCase() !== "bearer" ||
    typeof payload.access_token !== "string" ||
    typeof payload.refresh_token !== "string" ||
    typeof payload.expires_in !== "number" ||
    payload.expires_in < 1
  ) {
    throw new AmoCrmRequestError("OAuth token response has an invalid shape");
  }
  return {
    accessToken: payload.access_token,
    replacementRefreshToken: payload.refresh_token,
    expiresIn: payload.expires_in,
  };
}

/** Fetches only a whitelisted read resource. No POST/PATCH/PUT/DELETE equivalent exists by design. */
export async function getAmoCrmReadOnly<T>(
  resource: AmoCrmReadResource,
  query?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const { accessToken } = await refreshAmoCrmAccessToken();
  const url = new URL(ALLOWED_RESOURCES[resource], config().baseUrl);
  for (const [name, value] of Object.entries(query ?? {}))
    if (value !== undefined) url.searchParams.set(name, String(value));
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/hal+json",
    },
    cache: "no-store",
  });
  if (!response.ok)
    throw new AmoCrmRequestError(`amoCRM read failed (${response.status})`);
  return (await response.json()) as T;
}
