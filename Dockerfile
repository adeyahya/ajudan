FROM node:20-alpine as base
RUN corepack enable
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

FROM base as installer
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install
ENV NODE_ENV production
RUN pnpm build

FROM installer as prod-install
COPY package.json .
COPY pnpm-lock.yaml .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

FROM node:20-alpine as executable
WORKDIR /app
COPY drizzle /app/drizzle
COPY public /app/public
COPY --from=installer /app/dist /app/dist
COPY --from=prod-install /app/node_modules /app/node_modules
ENV NODE_ENV production
CMD ["node", "dist/server/entry.mjs"]