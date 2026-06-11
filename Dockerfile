FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=4000
ENV REQUIRE_API_KEY=true
EXPOSE 4000
CMD ["node", "server.js"]
