# Builds the website and the multiplayer server, then keeps only what is needed to run them.
FROM docker.io/library/node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Where the Source links point; pass --build-arg VITE_SOURCE_URL=<your repository> when you serve changed code
ARG VITE_SOURCE_URL=
RUN npm run build

FROM docker.io/library/node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0
# The server bundle only needs the ws package at runtime
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules/ws ./node_modules/ws
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist-server/main.js"]
