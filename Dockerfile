FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
COPY prompts/ prompts/

RUN npm run build

FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist/ dist/
COPY prompts/ prompts/

EXPOSE 3000

CMD ["node", "dist/index.js"]
