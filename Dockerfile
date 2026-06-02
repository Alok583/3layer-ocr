FROM node:20-slim

# Install system dependencies for Sharp (image processing)
RUN apt-get update && apt-get install -y \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (caching layer)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source files
COPY . .

EXPOSE 3000

CMD ["node", "src/server.js"]
