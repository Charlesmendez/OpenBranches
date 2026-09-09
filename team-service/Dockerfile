FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY vendor/extract-zip ./vendor/extract-zip
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY team-service/package.json team-service/package-lock.json ./team-service/
RUN npm ci --prefix team-service --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY team-service/src ./team-service/src
COPY scripts/build-team.mjs ./scripts/build-team.mjs
RUN node scripts/build-team.mjs

FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4389
WORKDIR /app/team-service
COPY team-service/package.json team-service/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/team-service/dist ./dist
COPY team-service/migrations ./migrations
USER node
EXPOSE 4389
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:4389/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
