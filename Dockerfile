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
ENV NODE_ENV=production PORT=20031
COPY package.json package-lock.json* ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm install --omit=dev -w backend
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist backend/public
EXPOSE 20031
CMD ["node", "backend/dist/index.js"]
