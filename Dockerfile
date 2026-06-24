# Use the official Node.js LTS image
FROM node:22-slim

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Expose the port (Cloud Run automatically routes requests to the PORT env var)
EXPOSE 8080

# Run the server on startup
CMD [ "npm", "start" ]
