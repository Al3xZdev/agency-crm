# syntax=docker/dockerfile:1
# Production image for the Next.js app (standalone output; see next.config.ts).

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
ARG INTERNAL_API_URL=http://api:3000
ENV WEB_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1 INTERNAL_API_URL=${INTERNAL_API_URL}
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN pnpm --filter @agency-crm/shared build \
 && pnpm --filter @agency-crm/web build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
