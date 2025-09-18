# ArtifactFetcher

**Docker イメージ / npm パッケージ / (将来) Hugging Face モデル** を、  
サーバーサイドで依存関係を解決しながら取得し、  
SSE で進捗を可視化しつつクライアントからダウンロードできる Web アプリ & CLI です。

- Next.js (App Router) + Node.js ランタイム  
- 進捗通知: `EventEmitter` → Server‑Sent Events (SSE)  
- Docker: image の **pull → tar 出力**、および **tar から任意 Registry へ push** に対応  
- npm: **lockfile 準拠**/ もしくは **パッケージ名@semver → 依存解決 → 全 tarball 取得**（SSE 対応）  

---

## 目次
- [要件](#要件)
- [セットアップ](#セットアップ)
  - [ローカル開発 (compose)](#ローカル開発-compose)
  - [Docker イメージ（standalone）をビルド](#docker-イメージstandaloneをビルド)
  - [GitHub Actions で自動ビルド](#github-actions-で自動ビルド)
- [環境変数](#環境変数)
- [使い方](#使い方)
  - [Web UI](#web-ui)
  - [CLI](#cli)
  - [SSE 進捗イベント](#sse-進捗イベント)
- [機能詳細](#機能詳細)
  - [Docker イメージのダウンロード（tar）](#docker-イメージのダウンロードtar)
  - [Docker イメージのアップロード（tar → Registry）](#docker-イメージのアップロードtar--registry)
  - [npm パッケージのダウンロード](#npm-パッケージのダウンロード)
- [トラブルシュート](#トラブルシュート)
- [ライセンス](#ライセンス)

---

## 要件
- Node.js 18+（サーバサイド実行に使用）  
- Docker（イメージビルド/実行時に使用）  
- (任意) Redis などは不要です（メモリ内の JobStore を採用）  

## セットアップ

### ローカル開発 (compose)
```bash
# 1) 依存インストール
npm ci

# 2) 開発実行（環境変数は .env 参照）
npm run dev

# もしくは Docker Compose（ホットリロード用途）
docker compose up --build -d
```

> compose 例（抜粋）
```yaml
services:
  artifactfetcher:
    image: node:24.5
    working_dir: /app
    volumes:
      - ./:/app
    ports:
      - "3000:3000"
    command: sh -c "npm ci && npm run dev"
    env_file:
      - .env.local
```

### Docker イメージ（standalone）をビルド
> 本番用に軽量なイメージを作ります。`next.config.ts` は `output: 'standalone'` を推奨。

```bash
# 単一アーキ（amd64）
docker build -t yourname/artifactfetcher:latest .

# マルチアーキ（amd64/arm64）
docker buildx create --name afbuilder --driver docker-container --use || true
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t yourname/artifactfetcher:latest \
  --push .
```

### GitHub Actions で自動ビルド
`.github/workflows/docker.yml` の例（要約）  
- main へ push → Docker Hub に multi-arch で push  
- `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` を Secrets に設定  

---

## 環境変数
> **実行時に切り替え**可能なものは Route Handler / Server Action から `process.env` を参照し、クライアントは API 経由で取得します。

| 変数 | 既定 | 説明 |
|---|---|---|
| `PORT` | `3000` | Web サーバ待受ポート |
| `DOCKER_UPLOAD` | `false` | `true/1/on/yes` で **Docker push 機能を有効化**（API 側でガード） |
| `NODE_TLS_REJECT_UNAUTHORIZED` | | 自己署名のレジストリ等へ接続する場合は `0` に |
| `S3_ACCESS_KEY_ID` |  | S3 アクセスキー（MinIO の Access Key） |
| `S3_SECRET_ACCESS_KEY` |  | S3 シークレットキー（MinIO の Secret Key） |
| `S3_ENDPOINT` |  | MinIO など S3 互換ストレージのエンドポイント URL（例: `http://minio:9000`） |
| `S3_BUCKET` |  | npm などで生成したアーカイブを保存するバケット名 |
| `S3_REGION` | `us-east-1` | S3 クライアントに渡すリージョン（MinIO でも必須） |
| `S3_FORCE_PATH_STYLE` | `true` | パススタイルアクセスを強制するか（MinIO は `true` 推奨） |

`.env.production` 例：
```dotenv
DOCKER_UPLOAD=true
```
compose:
```yaml
services:
  artifactfetcher:
    image: yourname/artifactfetcher:latest
    ports: ["3000:3000"]
    env_file: [.env.production]
```

---

## 使い方

### Web UI
1. トップ画面で **Docker repo/tag** または **npm name@range** を入力  
2. **Start** でジョブ開始 → SSE で進捗が流れます  
3. 完了後、ブラウザが自動で `.tar` をダウンロード  
4. （オプション）Docker tar を **任意 Registry に push**（UI から複数ファイル一括アップロード可）  
5. `/admin` からアクセスできる管理ページで、リクエストの履歴（時刻・IP・エンドポイント）を確認可能  

### CLI
Web サーバに対して CLI からダウンロードを発火できます。

```bash
# 形式: npm run download -- <docker|npm> <name> <tag|semver> [--platform <os/arch>] [--host <URL>] [--out <dir>]

# Docker イメージ
npm run download -- docker library/ubuntu latest --platform linux/amd64 --host https://downloader.example.com --out downloads

# npm パッケージ（semver）
npm run download -- npm next ^18 --host https://downloader.example.com --out downloads
```

出力例:  
- Docker: `downloads/library_ubuntu@latest.tar`  
- npm:    `downloads/next-^18.tar`（lock 相当の依存を解決し全 tarball を格納）  

### SSE 進捗イベント
`/api/build/progress?jobId=...` に対し、次のイベントが JSON で飛びます。

共通（`type`）:  
- `stage` … ステージ名（例: `resolve-manifest`, `download-layer-0`, `tar-writing`, `push-start: ...`）  
- `manifest-resolved` … Docker: レイヤ数 / npm: アイテム数  
- `item-start` / `item-progress` / `item-done` … 進捗（`scope: 'download' | 'upload' | 'push-layer' | 'npm'`）  
- `item-skip` … 既存キャッシュ等で送信を省略  
- `error` / `done`  

---

## 機能詳細

### Docker イメージのダウンロード（tar）
- Docker Hub の **token 取得 → manifest 解決（platform 対応）→ 各 layer/config を検証付きでダウンロード**  
- `manifest.json` を `docker load` 形式に整形し、`.tar` を生成  
- 生成した `.tar` は S3 (MinIO) にアップロードし、クライアントからは S3 経由でストリーミングダウンロード  
- 進捗は **layer ごと**にバイト数で SSE 送出  

#### API（サーバ内）
- `POST /api/build/start` … { repo, tag, platform } → { jobId }  
- `GET  /api/build/progress?jobId=...` … SSE  
- `GET  /api/build/download?jobId=...` … `.tar` ダウンロード  

### Docker イメージの アップロード（tar → Registry）
- 複数 `.tar` を **multipart** で送信しながら、**受信進捗**を SSE で通知  
- 受信後、`useManifest=true` なら tar 内の `manifest.json` から `repository:tag` を決定  
- Registry v2 API（`POST /blobs/uploads/` → `PATCH` → `PUT?digest=`）で push  
  - 既に存在する blob は `HEAD /blobs/<digest>` で検出し、**擬似進捗 100%** or `item-skip` を送出  

#### API
- `POST /api/push/upload-multi?jobId=...&registry=...&useManifest=true&username=...&password=...`  
  body: `files[]=@image1.tar, files[]=@image2.tar ...`  

### npm パッケージのダウンロード
- **lockfile 準拠**または **`name@semver` 指定**の両方に対応  
- npm registry のメタから **依存を再帰解決 → すべての tarball を取得 → 1つの `.tar` に収容**  
- 進捗は **解決件数 / 個別 tarball のバイト数**で SSE 送出  

### npm パッケージのアップロード
- 生成済みの npm バンドル (`.tar` / `.tgz`) を複数まとめて選択し、サーバ側で `npm publish <tarball>` を実行して Nexus など任意のレジストリへ公開  
- UI からレジストリ URL、Auth Token または Basic 認証情報を指定でき、進捗は SSE でモーダル表示  
- 例: `https://nexus.example.com/repository/npm-hosted` + Auth Token（もしくはユーザー/パスワード）  

---

## トラブルシュート
- `<Html> should not be imported outside of pages/_document`  
  → App Router で `next/document` を import していないか確認。`app/layout.tsx` に `<html><body>` を直接書く。  
- build が遅い / 30分以上かかる  
  → マルチアーキを QEMU でビルドしている可能性。**amd64 のみにする**か、**arm64 ネイティブランナー**を用意。  
- Registry へ push で 401/501  
  → 逆プロキシで `Location` の書き換えが必要な場合あり。`/v2/<repo>/blobs/uploads/` の Location を正規化してアクセスしているか確認。  
- Vercel で落ちる  
  → 大きなストリーミング/長時間ジョブは **自前の Node ランタイム** (Docker) で。  

---

## ライセンス
MIT
