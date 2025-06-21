FROM node:22-alpine AS builder

RUN npm i -g corepack && corepack enable

WORKDIR /app

COPY package.json ./

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install

COPY . .

RUN pnpm build

COPY . .

# ===

FROM node:22-alpine AS runtime

RUN npm i -g corepack && corepack enable

RUN addgroup -g 1001 -S rivet && \
    adduser -S rivet -u 1001 -G rivet

WORKDIR /app

COPY --from=builder --chown=rivet:rivet /app/package.json ./

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod

COPY --from=builder --chown=rivet:rivet /app/dist ./dist

USER rivet

CMD ["node", "dist/server.js"]

