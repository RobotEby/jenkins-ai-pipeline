FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ARG APP_COMMIT=development
ENV APP_COMMIT=${APP_COMMIT}
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts/smoke.js ./scripts/smoke.js
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health',{signal:AbortSignal.timeout(2000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
