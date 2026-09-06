FROM node:20-alpine

WORKDIR /app

# Upgrade vulnerable Alpine OpenSSL packages.
RUN apk upgrade --no-cache libcrypto3 libssl3

# Copy dependency manifests first to improve Docker layer caching.
COPY package*.json ./

# Install the exact production dependencies from package-lock.json.
RUN npm ci --omit=dev

# npm is only required during the image build, not at runtime.
RUN rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx

# Copy the application source .
COPY . .

EXPOSE 3000

CMD ["node", "src/server.js"]