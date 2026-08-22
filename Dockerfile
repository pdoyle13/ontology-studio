# Ontology Studio — UI + sidecar server in one image.
# Pair with an Oxigraph container (see docker-compose.yml).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY seed ./seed
COPY --from=build /app/dist ./dist
ENV SERVE_UI=1 \
    STUDIO_SERVER_PORT=7881 \
    OXIGRAPH_URL=http://oxigraph:7878
EXPOSE 7881
CMD ["node", "--experimental-sqlite", "server/index.mjs"]
