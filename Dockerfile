FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY app/package*.json ./
RUN npm install --omit=dev

# Copy entire app (including internal/)
COPY app/ .

# Make start script executable
RUN chmod +x start.sh

# Expose ports
EXPOSE 3000 8080

# Start both services
CMD ["./start.sh"]
