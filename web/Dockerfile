# Jellyflix Web: build the static app, then serve it with nginx.
#   docker build -t jellyflix-web .
#   docker run -d -p 8080:80 -e JELLYFIN_URL=http://192.168.x.x:8096 jellyflix-web
# The build output is plain files, so it is made once on the builder's own CPU whatever platform the image is for.
FROM --platform=$BUILDPLATFORM node:25-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.29-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
