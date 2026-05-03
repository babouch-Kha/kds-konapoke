FROM mcr.microsoft.com/playwright:v1.45.0-jammy

WORKDIR /app

# Copy scraper files
COPY scraper/package*.json ./scraper/
RUN cd scraper && npm install

# Copy all project files
COPY . .

# Expose port
EXPOSE 3456

# Start the server
CMD ["node", "scraper/server.js"]
