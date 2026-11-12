FROM node:20-alpine AS build
WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm install
COPY worker/package*.json ./worker/
RUN cd worker && npm install
COPY backend ./backend
COPY worker ./worker
RUN cd backend && npm run build

FROM node:20-alpine
WORKDIR /app/backend
ENV NODE_ENV=production
COPY --from=build /app/backend/package*.json ./
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
EXPOSE 4000
CMD ["node", "dist/server.js"]
