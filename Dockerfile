FROM node:22-alpine
RUN apk add --no-cache ffmpeg zip
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY config ./config
COPY LICENSE THIRD-PARTY-NOTICES.md ./
RUN mkdir /app/private && chown node:node /app/private
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4310 DATA_DIR=/app/private
EXPOSE 4310
CMD ["node","src/server.mjs"]
