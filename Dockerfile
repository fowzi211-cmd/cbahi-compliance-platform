# One image, two processes (ARCHITECTURE §1, deployment shape): the Next.js server (`web`, the
# default command) and the pg-boss worker (`pnpm worker`). The same image runs the one-off
# database steps (`pnpm db:deploy`, `pnpm db:seed`, `pnpm platform:admin`), which need the
# dev tooling (tsx, prisma CLI), so dependencies are installed in full.
FROM node:22-bookworm-slim

# pnpm is fetched once at build time into a shared folder, so the unprivileged runtime user
# never needs the network to start it.
ENV COREPACK_HOME=/usr/local/share/corepack
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate \
  && chmod -R a+rX "$COREPACK_HOME" && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN pnpm install --frozen-lockfile

COPY . .
# Prerendering validates the environment, so the build borrows the local example values (no
# secrets, nothing is connected to). The real values arrive at run time from deploy/.env.
RUN cp .env.example .env && pnpm build && rm .env && chown -R node:node .next

ENV NODE_ENV=production \
  PORT=3000 \
  HOSTNAME=0.0.0.0 \
  NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
USER node
CMD ["pnpm", "start"]
