FROM node:16-alpine

USER node
WORKDIR "/home/node"

COPY ./package.json .
COPY ./index.js .

# install npm packages
RUN npm install --no-package-lock

EXPOSE 3000

CMD ["node", "index.js"]