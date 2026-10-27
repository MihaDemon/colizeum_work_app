FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# A one-time static publisher; nginx runs separately in the infra service.
FROM alpine:3.22
COPY --from=build /app/dist /opt/frontend
COPY publish.sh /usr/local/bin/publish-frontend
RUN chmod +x /usr/local/bin/publish-frontend && mkdir -p /usr/share/nginx/html
CMD ["/usr/local/bin/publish-frontend"]
