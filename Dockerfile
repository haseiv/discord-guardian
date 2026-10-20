FROM node:24-slim

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV DATA_FILE=/app/data/state.json

CMD ["node", "dist/index.js"]
