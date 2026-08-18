FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS production-dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg fonts-noto-cjk python3 python3-venv tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt \
  && groupadd --gid 10001 app \
  && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin app

COPY --from=production-dependencies --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/dist ./dist
COPY --from=build --chown=10001:10001 /app/package.json ./package.json
COPY --from=build --chown=10001:10001 --chmod=755 /app/deploy/entrypoint.sh ./deploy/entrypoint.sh

ENV NODE_ENV=production \
  PATH="/opt/venv/bin:$PATH" \
  FFMPEG_PATH=/usr/bin/ffmpeg \
  HOST=0.0.0.0 \
  PORT=8787

USER 10001:10001
EXPOSE 8787

ENTRYPOINT ["/usr/bin/tini", "--", "/app/deploy/entrypoint.sh"]
CMD ["node", "dist/server/index.js"]
