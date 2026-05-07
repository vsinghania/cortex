# syntax=docker/dockerfile:1.7

# ---- builder ----
# Has full dev dependencies (tsx, typescript, @types) + source + compiled
# output. Used as-is by docker-compose.dev.yml for hot-reload via tsx watch.
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- prod-deps ----
# Strips dev dependencies so the runtime stage gets a slim node_modules.
FROM builder AS prod-deps
RUN npm prune --omit=dev

# ---- runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

USER node

EXPOSE 3000
EXPOSE 3010

CMD ["node", "dist/web-server/server.js"]
