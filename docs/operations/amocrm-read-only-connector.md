# amoCRM: read-only connector for Neo

The connector is a server-only boundary. It can refresh OAuth access and calls
only `GET` for account, leads, contacts, companies, users, and pipelines. It
contains no CRM method for creation, editing, deletion, tagging, assignment, or
closing entities.

## Production provisioning

1. Register the exact HTTPS redirect URI in the amoCRM integration settings.
2. Add `AMOCRM_BASE_URL`, client ID, client secret, redirect URI, and refresh
   token to the host-local `.env.production`/secret store. Never commit them or
   expose browser variables.
3. Recreate the app after setting or rotating a secret:

   `docker compose -f docker-compose.production.yml --env-file .env.production up -d --no-deps --force-recreate app`

4. Before enabling analytics, run `npm run test:security:amocrm-read-only` and
   perform one account-read probe. A failed probe is not a connection.

The provider rotates the refresh token. Its replacement must be saved atomically
by the host secret store; it is never logged, returned to a browser, or stored
in Git. Authorization callback/UI is a separate owner action and is not exposed
by this connector.

## Boundary

OAuth credential refresh is authorization maintenance, not a CRM data mutation.
Any future CRM mutation needs a separately reviewed implementation and the
owner's explicit per-action confirmation.
