# =========================
# 0) base: Node + Python3/pip/twine 共通ベース
# =========================
FROM node:24.5-trixie-slim AS base

# 必要ツールの導入（Debian パッケージで揃えるのが安全）
# - python3, python3-pip, python3-venv
# - python3-twine: twine CLI（PyPI ではなく Debian パッケージで導入）
# - ca-certificates: TLS
# - git: npm/pip で git 依存を取る可能性に配慮（不要なら削ってOK）
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        python3 python3-pip python3-venv twine \
        ca-certificates git; \
    rm -rf /var/lib/apt/lists/*

# =========================
# 1) deps: lockfileに従って依存DL
# =========================
FROM base AS deps
WORKDIR /app
ENV NODE_ENV=development
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# =========================
# 2) builder: Next build（standalone）
# =========================
FROM base AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# =========================
# 3) runner: 本番最小ランタイム（Python/twine も利用可）
# =========================
FROM base AS runner
WORKDIR /app

# セキュア既定
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# 非rootで実行（ホームを用意）
RUN useradd -ms /bin/bash nextjs
USER nextjs

# standalone 実行に必要な最小ファイルだけコピー
COPY --chown=nextjs:nextjs --from=builder /app/.next/standalone ./
COPY --chown=nextjs:nextjs --from=builder /app/.next/static ./ .next/static
COPY --chown=nextjs:nextjs --from=builder /app/public ./public

# 健康チェック（任意: /api/health があれば差し替え）
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000').then(r=>{if(r.ok)process.exit(0);process.exit(1)}).catch(()=>process.exit(1))"

EXPOSE 3000

# .next/standalone は server.js をルートに含む
CMD ["node", "server.js"]