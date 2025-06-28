# Stage 1: Build Stage
FROM node:lts-alpine AS build

# Set the working directory inside the container
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production --frozen-lockfile && npm cache clean --force

# Copy the rest of the application code
COPY . .

# Stage 2: Production Stage
FROM gcr.io/distroless/nodejs20-debian12

# Set the working directory inside the container
WORKDIR /app

# Copy only the necessary files from the build stage
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/app.js /app/app.js

# Expose the port the app runs on
EXPOSE 3003

# Start the application
CMD ["app.js"]
