FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci

COPY . .

RUN npm run build

FROM node:20-alpine AS runner

RUN apk add --no-cache postgresql-client tini

RUN addgroup -g 1001 nodegroup && \
    adduser -u 1001 -G nodegroup -s /bin/sh -D nodeuser

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/attached_assets ./attached_assets
COPY --from=builder /app/scripts/migrate-ratelimit.cjs ./scripts/migrate-ratelimit.cjs
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

RUN chown -R nodeuser:nodegroup /app

USER nodeuser

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

ENTRYPOINT ["tini", "--"]
CMD ["./entrypoint.sh"]
