# callhand: one Node process (web UI, voice WebSocket, WhatsApp webhook and WebRTC call media) on port 8787.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# devDependencies are needed: `npm start` runs through tsx and the build uses vite.
RUN npm ci --include=dev
COPY . .
RUN npm run build
# data/ (db.json, photos) must live on a volume; .env is passed with --env-file, never baked in.
VOLUME ["/app/data"]
EXPOSE 8787
CMD ["npm", "start"]
