FROM node:20-alpine

WORKDIR /app

# Copy dependency manifests first to improve Docker layer caching.
COPY package*.json ./

# Install the exact production dependencies from package-lock.json.
RUN npm ci --omit=dev

# Copy the application source code.
COPY . .

EXPOSE 3000

CMD ["node", "src/server.js"]