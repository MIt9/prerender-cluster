FROM node:16-alpine

ENV CHROME_BIN="/usr/bin/chromium-browser" \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="true"
RUN set -x \
    && apk update \
    && apk upgrade \
    && apk add --no-cache \
    udev \
    ttf-freefont \
    chromium

USER node
WORKDIR "/home/node"

COPY ./package.json .
COPY ./index.js .

# install npm packages
RUN npm install --no-package-lock

EXPOSE 3000

CMD ["node", "index.js"]