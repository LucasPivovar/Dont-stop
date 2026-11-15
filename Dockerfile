FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node . .
RUN mkdir -p /app/.data && chown node:node /app/.data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3100
USER node
EXPOSE 3100
CMD ["node", "server/gym.cjs"]
