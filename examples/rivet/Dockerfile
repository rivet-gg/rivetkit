FROM node:22-alpine AS builder

RUN npm i -g corepack && corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
# HACK: Remove worker.ts bc file is invalid in Node
RUN rm src/worker.ts && pnpm build

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile

FROM node:22-alpine AS runtime

RUN addgroup -g 1001 -S rivet && \
    adduser -S rivet -u 1001 -G rivet

WORKDIR /app

COPY --from=builder --chown=rivet:rivet /app/dist ./dist
COPY --from=builder --chown=rivet:rivet /app/node_modules ./node_modules
COPY --from=builder --chown=rivet:rivet /app/package.json ./

USER rivet

CMD ["node", "dist/server.js"]