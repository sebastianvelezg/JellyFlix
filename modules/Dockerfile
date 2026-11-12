# Jellyflix Modules: the optional container with extra modules (retro TV channels, Match, and Seerr when it is turned on).
#   docker build -t jellyflix-modules .        (from this folder)
# It has no dependencies to install: Node runs the TypeScript files as they are (type stripping) and keeps its data in SQLite (node:sqlite).
# The base image is pinned by digest (the same one the web image builds with); Dependabot proposes updates to it.
FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4

ENV NODE_ENV=production \
    DATA_DIR=/data \
    HOST=0.0.0.0 \
    PORT=8097 \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

WORKDIR /app
COPY package.json ./
COPY contract ./contract
COPY server/src ./server/src

# The database lives in /data (a volume). Everything else is read-only code.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8097
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8097/v1/health || exit 1
CMD ["node", "server/src/main.ts"]
