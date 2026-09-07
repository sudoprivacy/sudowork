# syntax=docker/dockerfile:1
# Sudowork WebUI — monorepo multi-stage build.
# Build context is the repo ROOT (the webui is a bun workspace member that consumes
# @sudowork/* packages), so build it via docker-compose or:
#   docker build -f apps/webui/Dockerfile -t sudowork-webui .
# from the repository root. Build with bun (workspace tooling), run with node.

FROM oven/bun:1.3 AS build
WORKDIR /app

# A frozen install against the shared workspace lockfile needs every member's
# manifest present, so copy all of them (manifests only → dependency layer caches
# across source edits). patches/ is required by root patchedDependencies.
COPY package.json bun.lock ./
COPY apps/desktop/package.json apps/desktop/
COPY apps/webui/package.json apps/webui/
COPY packages/common/package.json packages/common/
COPY packages/contracts/package.json packages/contracts/
COPY packages/host-bridge/package.json packages/host-bridge/
COPY packages/moss-client/package.json packages/moss-client/
COPY packages/renderer/package.json packages/renderer/
COPY packages/ui/package.json packages/ui/
COPY patches/ patches/

# --ignore-scripts: this build only produces the webui, so skip every workspace
# member's install lifecycle — most importantly the desktop app's postinstall,
# whose script isn't in the context (manifest-only copy). No webui runtime dep
# compiles: node-pty ships a prebuilt @lydell/node-pty-linux-x64 package, and the
# desktop-only natives (better-sqlite3 etc.) are never loaded by the webui server.
# The env vars keep transitive electron/playwright binary downloads out of resolve.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    HUSKY=0
RUN bun install --frozen-lockfile --ignore-scripts

# Sources for the shared packages + the webui app.
COPY packages/ packages/
COPY apps/webui/ apps/webui/

# Build the shared package dist (contracts/common/moss-client/host-bridge) that the
# webui server resolves at runtime, then the webui itself (vite client bundle +
# tsc server → apps/webui/dist).
RUN bun run build:packages
RUN bun run --filter sudowork-webui build

# Production-only dependency layer: same manifest-only + patches copy as the build
# stage (frozen install needs every member manifest), but with --production so the
# whole build/test toolchain (electron/electron-builder/electron-vite/vite/vitest/
# @playwright/test/typescript/sass/eslint …, all devDependencies) is dropped.
# bun uses an isolated layout for this workspace (central node_modules/.bun store +
# per-member symlink layers), so this stage yields the pruned root store AND the
# pruned apps/webui/node_modules symlink layer the runtime needs.
FROM oven/bun:1.3 AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/desktop/package.json apps/desktop/
COPY apps/webui/package.json apps/webui/
COPY packages/common/package.json packages/common/
COPY packages/contracts/package.json packages/contracts/
COPY packages/host-bridge/package.json packages/host-bridge/
COPY packages/moss-client/package.json packages/moss-client/
COPY packages/renderer/package.json packages/renderer/
COPY packages/ui/package.json packages/ui/
COPY patches/ patches/
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    HUSKY=0
RUN bun install --frozen-lockfile --ignore-scripts --production

FROM node:22-slim AS runtime
# glibc runtime to match the native @lydell/node-pty binary fetched on the debian
# build image (alpine/musl would fail to load it).
WORKDIR /app/apps/webui
ENV NODE_ENV=production

# bun's isolated layout resolves the webui server's modules through THREE layers,
# all required at runtime:
#   1. root /app/node_modules — the .bun central store (pruned to prod deps here)
#   2. /app/apps/webui/node_modules — the member symlink layer (Node's resolution
#      entry point; without it the server fails with `Cannot find module 'express'`)
#   3. /app/packages — the @sudowork/* symlink targets, with their built dist
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/apps/webui/node_modules /app/apps/webui/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/apps/webui/dist /app/apps/webui/dist
COPY --from=build /app/apps/webui/package.json /app/apps/webui/package.json
# Migration .sql files live outside dist (tsc doesn't copy them); the migrate entry
# reads process.cwd()/migrations, so they must be present in the runtime image.
COPY --from=build /app/apps/webui/migrations /app/apps/webui/migrations

EXPOSE 26808
CMD ["node", "dist/server/index.js"]
