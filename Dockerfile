FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
FROM deps AS build
COPY . .
RUN npm run build
FROM node:24-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
USER node
CMD ["node", "apps/api/dist/server.js"]
FROM node:24-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/apps/web/.output ./apps/web/.output
USER node
CMD ["node", "apps/web/.output/server/index.mjs"]
