# Built from the repo root (it needs the workspace files and shared/): see deploy/docker-compose.yml.
# Debian, not Alpine: sharp and onnxruntime-node ship glibc binaries.
# Dev dependencies stay in the image on purpose: migrations (drizzle-kit) and catalog:import (tsx)
# run from it. A slimmer image can come when disk or pull time starts to matter.
FROM node:22.14-bookworm-slim

# Without this onnxruntime-node downloads its CUDA libraries on Linux, which a CPU server never uses.
ENV ONNXRUNTIME_NODE_INSTALL=skip
ENV CI=true
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
COPY shared/package.json shared/
RUN pnpm install --frozen-lockfile --filter @closet-ai/server...

COPY shared shared
COPY server server
RUN pnpm --filter @closet-ai/server build

# The embedding models go into the image, so the first photo doesn't wait for a ~200 MB download.
ENV MODEL_CACHE_DIR=/app/models
RUN pnpm --filter @closet-ai/server exec tsx src/scripts/fetch-models.ts
RUN chown -R node:node /app/models

ENV NODE_ENV=production
USER node
WORKDIR /app/server
CMD ["node", "dist/server.js"]
