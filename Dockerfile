# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl wget
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Placeholders только для сборки — runtime secrets задаются через env_file/orchestrator
ENV AUTH_SECRET=build-time-placeholder-minimum-32-characters-long
ENV AUTH_URL=https://localhost
ENV SCHEDULE_VIEW_TOKEN=build-time-placeholder-minimum-32-characters-long
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build

RUN npx prisma generate
RUN npm run build

# Минимальный образ только для prisma migrate status/deploy и ручных ops CLI (profile ops).
# Без исходников приложения целиком и без runtime secrets.
# Foundation seed (prisma/seed.production.ts) нуждается в @/ alias + узком наборе src/lib defaults.
FROM deps AS migrator
WORKDIR /app
COPY prisma ./prisma
COPY tsconfig.json ./tsconfig.json
COPY src/lib/bot-settings/defaults.ts ./src/lib/bot-settings/defaults.ts
COPY src/lib/legal-document/content-hash.ts ./src/lib/legal-document/content-hash.ts
COPY src/lib/legal-document/defaults.ts ./src/lib/legal-document/defaults.ts
COPY src/lib/studio-settings/defaults.ts ./src/lib/studio-settings/defaults.ts
RUN npx prisma generate
COPY scripts/ops/lib/prisma-migrate-status.ts ./scripts/ops/lib/prisma-migrate-status.ts
COPY scripts/ops/lib/classify-migrate-status-cli.ts ./scripts/ops/lib/classify-migrate-status-cli.ts
COPY scripts/ops/lib/game-promotions-canonical.ts ./scripts/ops/lib/game-promotions-canonical.ts
COPY scripts/ops/lib/staging-game-promotions-canonical.ts ./scripts/ops/lib/staging-game-promotions-canonical.ts
COPY scripts/ops/lib/staging-restore-game-promotions-cli.ts ./scripts/ops/lib/staging-restore-game-promotions-cli.ts
COPY scripts/data/import-services-data.ts ./scripts/data/import-services-data.ts
COPY scripts/ops/lib/production-bootstrap-canonical.ts ./scripts/ops/lib/production-bootstrap-canonical.ts
COPY scripts/ops/lib/production-bootstrap-data-cli.ts ./scripts/ops/lib/production-bootstrap-data-cli.ts
COPY scripts/create-owner.ts ./scripts/create-owner.ts
COPY scripts/lib/prompt.ts ./scripts/lib/prompt.ts
COPY src/lib/auth/password-policy.ts ./src/lib/auth/password-policy.ts

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
# Nodemailer без транзитивных deps. Явное копирование + `next build --webpack`
# страхуют standalone: Turbopack даёт require("nodemailer-<hash>") и битые symlink
# в multi-stage Docker (MODULE_NOT_FOUND внутри app-контейнера).
COPY --from=builder /app/node_modules/nodemailer ./node_modules/nodemailer
# Safe runtime flag marker used by staging/production post-deploy verification.
COPY --from=builder /app/src/lib/schedule/appointment-full-busy-writes-runtime.mjs ./scripts/ops/full-busy-writes-runtime-marker.mjs

RUN mkdir -p /app/exports/emergency \
  && chown -R nextjs:nodejs /app/exports

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
