# Use Node.js 18 as the base image
FROM node:20.8.0-alpine

# Set the working directory
WORKDIR /usr/src/app

USER root

# Copy 
COPY . .

# Install pnpm globally
RUN npm install -g pnpm@8.10.3

RUN pnpm -v

# Install dependencies using pnpm
RUN pnpm install

# Expose any necessary ports
EXPOSE 7300

# Command to run your application
CMD ["npx", "tsx", "./src/service.ts"]

