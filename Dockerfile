FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=5173
ENV GLOWHAVEN_DATA_DIR=/app/data

WORKDIR /app

COPY package.json ./
COPY . .

RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 5173

CMD ["node", "server.js"]
