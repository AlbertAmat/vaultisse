ARG NODE_VERSION=22-alpine

# ---------------------------------------------------------------------------
# 1) Build the Vue client (Vite)
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# 2) Compile the Express/TypeScript server
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS server-build
RUN apk add --no-cache python3 make g++
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# 3) Install production-only server dependencies (no devDependencies, no tsc)
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS server-deps
RUN apk add --no-cache python3 make g++
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

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

# Same runtime layout produced by build.sh, so the compiled server's
# relative path lookups (server/dist -> ../../../client) resolve the same
# way they do in the existing PM2/dist.zip deployment.
WORKDIR /app/dist

COPY --from=server-deps  /app/server/node_modules ./server/node_modules
COPY --from=server-build /app/server/package.json  ./server/package.json
COPY --from=server-build /app/server/dist          ./server/dist
COPY --from=server-build /app/server/src/assets    ./server/dist/assets

# YAZ Z39.50 client (built in the yaz-build stage) plus the shared libraries it
# links against; verified here so a broken build fails the image, not a lookup.
COPY --from=yaz-build /yaz-install/usr/local/ /usr/local/
RUN apk add --no-cache libxml2 libxslt icu-libs readline openssl \
    && which yaz-client \
    && yaz-client -V

# The upgrade SQL files applied automatically on startup (see
# server/src/migrate/index.ts and GitHub issue #26) - not built by either
# prior stage, so copied straight from the build context.
COPY assets/db ./assets/db
COPY --from=client-build /app/client/dist          ./client

RUN mkdir -p /app/logs \
    && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.API_PORT||3000,path:'/api/rest/app/version'},r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
