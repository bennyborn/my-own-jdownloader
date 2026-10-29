FROM node:22-bookworm-slim
WORKDIR /shots
RUN npm init -y >/dev/null && npm i playwright@1.49.1 && npx playwright install --with-deps chromium
