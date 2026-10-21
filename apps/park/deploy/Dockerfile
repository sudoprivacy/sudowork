FROM oven/bun:1.3.14 AS bundle
WORKDIR /src
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts \
    || bun install --frozen-lockfile --ignore-scripts
ENV PATH=/src/apps/park/node_modules/.bin:$PATH
RUN bun run --filter='@sudowork/common' build \
    && bun run --filter='@sudowork/contracts' build \
    && bun run --filter='@sudowork/moss-client' build \
    && cd apps/park && tsc --noEmit && bun run vite build \
    && bun build server.mjs --target=node --format=esm --outfile=server.bundle.mjs \
    && bun deploy/build-metadata.mjs
FROM node:22.22.1-trixie-slim
WORKDIR /app
COPY --from=bundle /src/apps/park/server.bundle.mjs ./server.mjs
COPY --from=bundle /src/apps/park/dist ./dist
COPY --from=bundle /src/apps/park/box-build.json ./box-build.json
ENV HOST=0.0.0.0 PORT=4176
CMD ["node", "server.mjs"]
