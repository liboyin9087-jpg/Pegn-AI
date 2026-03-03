# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: serve ──────────────────────────────────────────────────────────
FROM nginx:alpine AS runtime

COPY --from=builder /app/dist /usr/share/nginx/html
# nginx:alpine auto-runs envsubst on files in /etc/nginx/templates/ at startup
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Defaults work for both local Docker Compose (PORT=80) and Cloud Run (PORT=8080)
ENV PORT=80
ENV API_UPSTREAM=http://api:4000

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:${PORT}/health || exit 1

