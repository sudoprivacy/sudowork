# Sudowork WebUI — 多阶段构建（计划 3.6）
# 构建产物 dist/client + dist/server；生产依赖在 build 阶段用 bun 裁剪后拷贝到 node 运行时。

FROM oven/bun:1.3 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# 构建完成后剔除 devDependencies，仅保留运行时依赖
RUN bun install --frozen-lockfile --production

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations

EXPOSE 25808
CMD ["node", "dist/server/index.js"]
