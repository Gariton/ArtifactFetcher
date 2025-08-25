# =========================
# 1) deps: lockfileに従って依存DL
# =========================
FROM node:24.5-trixie-slim AS deps
WORKDIR /app
ENV NODE_ENV=development
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# =========================
# 2) builder: Next build（standalone）
# =========================
FROM node:24.5-trixie-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# =========================
# 3) runner: 本番最小ランタイム
# =========================
FROM node:24.5-trixie-slim AS runner
WORKDIR /app

# セキュア既定
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# 非rootで実行
RUN useradd -ms /bin/bash nextjs
USER nextjs

# standalone 実行に必要な最小ファイルだけコピー
#   - .next/standalone: Node実行物と必要なnode_modules
#   - .next/static:     静的アセット
#   - public:           公開ディレクトリ
COPY --chown=nextjs:nextjs --from=builder /app/.next/standalone ./ 
COPY --chown=nextjs:nextjs --from=builder /app/.next/static ./ .next/static
COPY --chown=nextjs:nextjs --from=builder /app/public ./public

# 健康チェック（任意: /api/health があれば差し替え）
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000').then(r=>{if(r.ok)process.exit(0);process.exit(1)}).catch(()=>process.exit(1))"

EXPOSE 3000

# .next/standalone は server.js をルートに含む
CMD ["node", "server.js"]