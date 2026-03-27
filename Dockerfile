# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

# NOTE: No .env is copied here.
# - In local Docker: mount .env via docker-compose or pass env vars.
# - In AWS ECS: env vars are injected by the task definition.

EXPOSE 3000

CMD ["node", "dist/main"]
