# N & F Laundry POS — API + built client in one image.
#
# The phone loads the app from this server and the server talks to Google
# Sheets. Keeping it one origin means the session cookie and every request
# behave exactly as they do in a desktop browser.

FROM node:22-alpine AS build
WORKDIR /app

# Install with the lockfile so the image matches what was tested.
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# --- runtime -----------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Run as a non-root user.
USER node

# The host tells us which port to listen on; API_PORT is left unset in
# production so the platform's PORT is used.
EXPOSE 4000
CMD ["node", "dist/server/server/index.js"]
