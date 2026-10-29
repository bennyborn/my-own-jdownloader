FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package.json package-lock.json* ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm install --omit=dev -w backend
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist backend/public
COPY plugins plugins
COPY extension extension
# Runs as the unprivileged "node" user. The entrypoint starts as root only to hand /app/data (a volume that older
# versions filled as root) to that user, then drops its rights.
RUN apk add --no-cache su-exec && mkdir -p data && chown node:node data
COPY docker-entrypoint.sh /usr/local/bin/
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "backend/dist/index.js"]
