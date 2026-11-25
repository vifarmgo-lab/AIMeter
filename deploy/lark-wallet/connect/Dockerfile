FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN cp deploy/lark-wallet/connect/index.html index.html && AIMETER_API_URL=/connect/api ./node_modules/.bin/vite build --base=/connect/ --outDir=/portal-web --sourcemap=false --emptyOutDir

FROM node:22-alpine
WORKDIR /portal
COPY --from=build /portal-web/index.html ./web/index.html
COPY --from=build /portal-web/assets ./web/assets
COPY deploy/lark-wallet/connect/server.mjs deploy/lark-wallet/connect/access.mjs deploy/lark-wallet/connect/gateway.mjs ./
USER node
ENTRYPOINT ["node","server.mjs"]
