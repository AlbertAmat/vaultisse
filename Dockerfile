ARG NODE_VERSION=22-alpine

# The repo is an npm workspaces monorepo (client, server, packages/*) with a
# single root lockfile, so every install runs from the repo root and the build
# context is the whole repo. Only the manifests are copied before `npm ci` so the
# dependency layers stay cached until a package.json / the lockfile changes.

# ---------------------------------------------------------------------------
# 1) Install every workspace's dependencies once (shared by both builds)
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY packages/types/package.json packages/types/
COPY packages/api-client/package.json packages/api-client/
RUN npm ci

# ---------------------------------------------------------------------------
# 2) Build the Vue client (Vite)
# ---------------------------------------------------------------------------
FROM deps AS client-build
COPY client/ client/
COPY packages/ packages/
RUN npm run build -w @vaultisse/client

# ---------------------------------------------------------------------------
# 3) Bundle the Express/TypeScript server into server/dist/index.js
#    (esbuild also bundles the shared @vaultisse/types, see server/scripts/build.js)
# ---------------------------------------------------------------------------
FROM deps AS server-build
COPY server/ server/
COPY packages/types/ packages/types/
RUN npm run build -w @vaultisse/server

# ---------------------------------------------------------------------------
# 3a) Install production-only server dependencies (no devDependencies, no tsc)
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS server-deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY packages/types/package.json packages/types/
COPY packages/api-client/package.json packages/api-client/
# The workspace symlinks (node_modules/@vaultisse/*) would dangle in the runtime
# image and aren't needed: the shared types are bundled into index.js.
RUN npm ci --omit=dev -w @vaultisse/server \
    && rm -rf node_modules/@vaultisse

# ---------------------------------------------------------------------------
# 3b) YAZ Z39.50 client, built from source: Alpine has no `yaz` package (only
# the unrelated `yazi` file manager), and the server shells out to
# `yaz-client` for the Italian (SBN) metadata lookup.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS yaz-build
ARG YAZ_VERSION=5.38.0
RUN apk add --no-cache build-base curl libxml2-dev libxslt-dev icu-dev openssl-dev readline-dev \
    && curl -fsSL "https://ftp.indexdata.com/pub/yaz/yaz-${YAZ_VERSION}.tar.gz" | tar -xz -C /tmp \
    && cd "/tmp/yaz-${YAZ_VERSION}" \
    && ./configure --prefix=/usr/local \
    && make -j"$(nproc)" \
    && make install DESTDIR=/yaz-install

# ---------------------------------------------------------------------------
# 4) Runtime image: just Node + compiled output, no build toolchain
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
ARG APP_VERSION=0.0.0-dev

ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    LOGGER_PATH=/app/logs

LABEL org.opencontainers.image.title="vaultisse" \
      org.opencontainers.image.description="Vaultisse — self-hosted personal/library book tracker" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.source="https://github.com/AlbertAmat/vaultisse" \
      org.opencontainers.image.licenses="MIT"

# Runtime layout: everything sits next to the bundled server (index.js) - these
# are the locations server/src/utils/Paths.ts resolves in production:
#   /app/index.js  /app/node_modules  /app/assets  /app/client  /app/db/upgrade  /app/logs
WORKDIR /app

COPY --from=server-deps  /app/node_modules        ./node_modules
COPY --from=server-build /app/server/dist/        ./
COPY --from=server-build /app/server/src/assets   ./assets

# YAZ Z39.50 client (built in the yaz-build stage) plus the shared libraries it
# links against; verified here so a broken build fails the image, not a lookup.
COPY --from=yaz-build /yaz-install/usr/local/ /usr/local/
RUN apk add --no-cache libxml2 libxslt icu-libs readline openssl \
    && which yaz-client \
    && yaz-client -V

# The upgrade SQL files applied automatically on startup (see
# server/src/migrate/index.ts and GitHub issue #26) - not built by either
# prior stage, so copied straight from the build context.
COPY assets/db ./db
COPY --from=client-build /app/client/dist          ./client

RUN mkdir -p /app/logs \
    && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.API_PORT||3000,path:'/api/rest/app/version'},r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "index.js"]
