# ArtifactFetcher

**Docker イメージ / npm パッケージ / Hugging Face モデル / GitLab リポジトリ・リリースアセット** を、
サーバーサイドで依存関係を解決しながら取得し、  
SSE で進捗を可視化しつつクライアントからダウンロードできる Web アプリ & CLI です。

- Next.js (App Router) + Node.js ランタイム  
- 進捗通知: `EventEmitter` → Server‑Sent Events (SSE)  
- Docker: image の **pull → tar 出力**、および **tar から任意 Registry へ push** に対応  
- npm: **lockfile 準拠**/ もしくは **パッケージ名@semver → 依存解決 → 全 tarball 取得**（SSE 対応）  
- GitLab: ArtifactFetcher からのみ到達できる GitLab の **リポジトリ ZIP / リリースアセット取得**（SSE 対応）

---

## 目次
- [要件](#要件)
- [セットアップ](#セットアップ)
  - [ローカル開発 (compose)](#ローカル開発-compose)
  - [Docker イメージ（standalone）をビルド](#docker-イメージstandaloneをビルド)
  - [GitHub Actions で検証](#github-actions-で検証)
- [環境変数](#環境変数)
- [使い方](#使い方)
  - [Web UI](#web-ui)
  - [CLI](#cli)
  - [SSE 進捗イベント](#sse-進捗イベント)
- [機能詳細](#機能詳細)
  - [Docker イメージのダウンロード（tar）](#docker-イメージのダウンロードtar)
  - [Docker イメージのアップロード（tar → Registry）](#docker-イメージのアップロードtar--registry)
  - [npm パッケージのダウンロード](#npm-パッケージのダウンロード)
  - [GitLab リポジトリ・リリースアセットのダウンロード](#gitlab-リポジトリリリースアセットのダウンロード)
- [トラブルシュート](#トラブルシュート)
- [ライセンス](#ライセンス)

---

## 要件
- Node.js 22.22.2+ または 24.15.0+（Node 24 LTS 推奨）
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
    image: node:24.15
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

### GitHub Actions で検証
`.github/workflows/ci.yml` が pull request と main への push で `npm ci`、型検査、ESLint、単体テスト、
本番ビルド、production dependency audit を実行します。

---

## 環境変数
> **実行時に切り替え**可能なものは Route Handler / Server Action から `process.env` を参照し、クライアントは API 経由で取得します。

| 変数 | 既定 | 説明 |
|---|---|---|
| `PORT` | `3000` | Web サーバ待受ポート |
| `DOCKER_UPLOAD` | `false` | `true/1/on/yes` で **Docker push 機能を有効化**（API 側でガード） |
| `NPM_UPLOAD` | `false` | `true/1/on/yes` で npm publish 機能を有効化（API 側でガード） |
| `PIP_UPLOAD` | `false` | `true/1/on/yes` で Python package upload 機能を有効化（API 側でガード） |
| `RPM_UPLOAD` | `false` | `true/1/on/yes` で RPM upload 機能を有効化（API 側でガード） |
| `S3_ACCESS_KEY_ID` |  | S3 アクセスキー（MinIO の Access Key） |
| `S3_SECRET_ACCESS_KEY` |  | S3 シークレットキー（MinIO の Secret Key） |
| `S3_ENDPOINT` |  | MinIO など S3 互換ストレージのエンドポイント URL（例: `http://minio:9000`） |
| `S3_BUCKET` |  | npm などで生成したアーカイブを保存するバケット名 |
| `S3_REGION` | `us-east-1` | S3 クライアントに渡すリージョン（MinIO でも必須） |
| `S3_FORCE_PATH_STYLE` | `true` | パススタイルアクセスを強制するか（MinIO は `true` 推奨） |
| `S3_OBJECT_PREFIX` | `artifact-fetcher/` | 生成物専用のS3 prefix。期限切れ孤児オブジェクトの走査対象をこのprefixに限定 |
| `APP_AUTH_USER` |  | 設定すると全ルートに Basic 認証を要求（`APP_AUTH_PASSWORD` と併用）。公開設置時は必須を推奨 |
| `APP_AUTH_PASSWORD` |  | 全体 Basic 認証のパスワード |
| `APP_ALLOWED_ORIGINS` |  | 状態変更リクエストのOrigin検証に追加する許可値（カンマ区切り。CORSを有効化する設定ではありません） |
| `TRUST_PROXY_HEADERS` | `false` | 信頼できるリバースプロキシ配下でのみ `true` にし、転送 Host/Proto を Origin 判定に利用 |
| `ADMIN_ENABLED` | `false` | `true/1/on/yes` で `/admin`（リクエストログ）を有効化 |
| `ADMIN_AUTH_USER` |  | 設定すると `/admin` 以下に専用の Basic 認証を要求（`ADMIN_AUTH_PASSWORD` と併用）。全体認証とは独立 |
| `ADMIN_AUTH_PASSWORD` |  | 管理画面 Basic 認証のパスワード |
| `JOB_TTL_MS` | `1800000` | 完了/失敗したジョブと進捗バスを破棄するまでの保持時間（ミリ秒） |
| `JOB_QUEUED_TTL_MS` | `600000` | POSTされなかったアップロード予約を破棄するまでの時間 |
| `JOB_RUNNING_TTL_MS` | `21600000` | 停止した実行中ジョブを破棄するまでの時間 |
| `JOB_MAX_RECORDS` | `1000` | 同時に保持するジョブ/アップロード予約の上限 |
| `JOB_SWEEP_INTERVAL_MS` | `300000` | 期限切れジョブを掃除する間隔（ミリ秒） |
| `SSE_MAX_CONNECTION_MS` | `1800000` | SSE接続をサーバー側で閉じるまでの最大時間 |
| `MAX_DOWNLOAD_ITEMS` | `5000` | 1ジョブで取得できるファイル/パッケージ数 |
| `MAX_SINGLE_FILE_BYTES` | `5368709120` | 1ファイルの最大サイズ（既定5 GiB） |
| `MAX_BUNDLE_BYTES` | `21474836480` | 1バンドルの最大合計サイズ（既定20 GiB） |
| `MAX_UPLOAD_FILES` | `100` | 1回のmultipart uploadで受け付ける最大ファイル数 |
| `MAX_UPLOAD_BYTES` | `21474836480` | 1回のupload requestの最大合計サイズ |
| `NPM_VIEW_TIMEOUT_MS` | `120000` | npmの公開済みversion確認コマンドのタイムアウト |
| `NPM_PUBLISH_TIMEOUT_MS` | `7200000` | npm publishコマンドのタイムアウト。Nexusまでの帯域と最大ファイルサイズに合わせて調整 |
| `PIP_ALLOW_SOURCE_DISTRIBUTIONS` | `false` | `true`時のみsdistを許可。sdistのbuild backendはコードを実行し得るため、信頼済み入力に限定 |
| `GITLAB_BASE_URL` |  | ArtifactFetcher から接続する GitLab のベース URL（例: `https://gitlab.internal.example`）。GitLab 機能の利用時は必須 |
| `GITLAB_TOKEN` |  | GitLab の Personal Access Token。UI で入力されたトークンがある場合はそちらを優先 |

> **セキュリティ**: 環境変数に設定したレジストリ認証情報はブラウザへ返されず、設定済みの送信先と一致する場合に限り
> Route Handler 内で付与されます。画面で一時入力した認証情報もクエリ文字列ではなく HTTP ヘッダ
> （`x-registry-username` / `x-registry-password` / `x-registry-token`）で送信され、アクセスログに残りません。
> このアプリはサーバーから任意の外部レジストリ/URL へ接続できるため、公開ネットワークに置く場合は
> `APP_AUTH_USER` / `APP_AUTH_PASSWORD` によるアクセス制御を有効化してください。

> TLS検証をプロセス全体で無効化する `NODE_TLS_REJECT_UNAUTHORIZED=0` は使用しないでください。
> 自己署名証明書が必要な場合は社内CAをコンテナのtrust storeへ追加するか、対象機能の明示的なTLS設定を利用してください。

> S3生成物は `S3_OBJECT_PREFIX` 配下に限定され、JobStoreのTTL削除に加えて定期的なprefix走査でも削除されます。
> 複数replicaやプロセス再起動後に残ったオブジェクトも対象になります。専用bucket/prefixを使用してください。

> RPM のダウンロードはパッケージ署名検証を既定で有効にしています。カスタムリポジトリは
> `id|label|url|gpgKeyUrl` 形式で、HTTPS の公開鍵 URL を必ず指定してください。

> pip/RPMの取得指定はレジストリ上のパッケージ識別子に限定されます。サーバー上で任意コードを
> 実行し得るローカルパス、VCS URL、direct referenceは受け付けません。pipのsdistも既定では無効です。

> **ローカル開発の HTTPS**: 通常の `npm run dev` はHTTPで起動します。`npm run dev:https` は
> `/etc/pki/tls/private/auth.key` と `/etc/pki/tls/certs/auth.crt` を参照するため、利用時は証明書を用意してください。

`.env.production` 例：
```dotenv
DOCKER_UPLOAD=true
APP_AUTH_USER=artifact-fetcher
APP_AUTH_PASSWORD=change-me
GITLAB_BASE_URL=https://gitlab.internal.example
GITLAB_TOKEN=glpat-example
```
compose:
```yaml
services:
  artifactfetcher:
    image: yourname/artifactfetcher:latest
    ports: ["3000:3000"]
    env_file: [.env.production]
```

`.env` / `env_file` はプロセスまたはコンテナの起動時に読み込まれます。値を変更した後は、開発サーバーを
再起動してください。Docker Compose の既存コンテナには後から反映されないため、次のように再作成します。

```bash
docker compose -f production.yaml up -d --force-recreate
```

---

## 使い方

### Web UI
1. トップ画面で **Docker repo/tag** または **npm name@range** を入力  
2. **Start** でジョブ開始 → SSE で進捗が流れます  
3. 完了後、ブラウザが自動で `.tar` をダウンロード  
4. （オプション）Docker tar を **任意 Registry に push**（UI から複数ファイル一括アップロード可）  
5. `/admin` からアクセスできる管理ページで、リクエストの履歴（時刻・IP・エンドポイント）を確認可能  
6. **GitLab** ではリポジトリ ZIP、またはプロジェクト内のリリースアセットを候補から選択して取得

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
- **任意の Docker Registry v2 互換レジストリ**に対応（Docker Hub / ghcr.io / quay.io / 社内レジストリ等）  
  - `WWW-Authenticate` チャレンジを解析し、**Bearer トークン取得**または **Basic 認証**を自動でネゴシエート  
  - `registry` 省略時は Docker Hub。公式イメージ（スラッシュ無し）は `library/` を自動補完  
  - `registry` 空欄でも `ghcr.io/owner/name` のように **repository へホストを埋め込む**書式を解釈  
  - プライベートイメージ向けに **username / password（またはトークン）** を指定可、自己署名証明書向けに **TLS 検証スキップ** に対応  
- manifest 解決（platform 対応）→ 各 layer/config を **digest 検証付き**でダウンロード  
- `manifest.json` を `docker load` 形式に整形し、`.tar` を生成（Docker Hub 以外はホスト名付きで `RepoTags` を付与）  
- 生成した `.tar` は S3 (MinIO) にアップロードし、クライアントからは S3 経由でストリーミングダウンロード  
- 進捗は **layer ごと**にバイト数で SSE 送出  

#### API（サーバ内）
- `POST /api/docker/start` … { repo, tag, platform, registry?, username?, password?, insecureTLS? } → { jobId }  
  - 認証情報は **リクエストボディ（JSON）でのみ**受け取り、ログには残さない  
- `GET  /api/build/progress?jobId=...` … SSE  
- `GET  /api/build/download?jobId=...` … `.tar` ダウンロード  

### Docker イメージの アップロード（tar → Registry）
- 複数 `.tar` を **multipart** で送信しながら、**受信進捗**を SSE で通知  
- 受信後、`useManifest=true` なら tar 内の `manifest.json` から `repository:tag` を決定  
- Registry v2 API（`POST /blobs/uploads/` → `PATCH` → `PUT?digest=`）で push  
  - 既に存在する blob は `HEAD /blobs/<digest>` で検出し、**擬似進捗 100%** or `item-skip` を送出  

#### API
- `POST /api/docker/upload-multi?jobId=...&registry=...&useManifest=true`
  body: `files[]=@image1.tar, files[]=@image2.tar ...`  
- 一時入力の認証情報はqueryへ入れず、`x-registry-username` / `x-registry-password` ヘッダで送信

### npm パッケージのダウンロード
- **lockfile 準拠**または **`name@semver` 指定**の両方に対応  
- npm registry のメタから **依存を再帰解決 → すべての tarball を取得 → 1つの `.tar` に収容**  
- 進捗は **解決件数 / 個別 tarball のバイト数**で SSE 送出  

### npm パッケージのアップロード
- 生成済みの npm バンドル (`.tar` / `.tgz`) を複数まとめて選択し、サーバ側で `npm publish <tarball>` を実行して Nexus など任意のレジストリへ公開  
- UI からレジストリ URL、Auth Token または Basic 認証情報を指定でき、進捗は SSE でモーダル表示  
- 例: `https://nexus.example.com/repository/npm-hosted` + Auth Token（もしくはユーザー/パスワード）  
- 公開済みの同一 `name@version` は削除・再公開しません。tarballのintegrityが一致すれば「登録済み」としてskipし、内容が違えば競合エラーにします
- 過去バージョンが存在していても、新しいversionは通常どおりpublishします

#### Nexus Repository 3運用上の注意

- hosted repositoryのDeployment Policyは既定の **Disable redeploy** を維持してください。npmの公開済みversionは不変として扱います
- Nexus 3.83.1を含む3.83.0〜3.89.1には、**Verify and Repair / Data Repair Plan** が有効なassetを誤削除する既知問題があります。このタスクを実行せず、3.90.0以降へ更新してください
- 削除が続く場合は、NexusのCleanup Policyとtask履歴も確認してください
- 参考: [Sonatype 3.83 release notes](https://help.sonatype.com/en/sonatype-nexus-repository-3-83-0-release-notes.html)、[Deployment Policy](https://help.sonatype.com/en/configurable-repository-fields.html)、[npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/)

### GitLab リポジトリ・リリースアセットのダウンロード
- 接続先はサーバー環境変数 `GITLAB_BASE_URL` で固定し、ブラウザから閉域 GitLab へ直接アクセスしない
- `group/subgroup/project` または数値の Project ID を指定可能
- ブランチ、タグ、コミット SHA を ref として指定可能。未指定時はデフォルトブランチを取得
- プロジェクトを指定してリリースタグ候補を取得し、`direct_asset_path` が設定されたアセットファイル候補から複数選択可能
- 1ファイル選択時は元ファイルをそのまま返し、複数選択時は1つの `.tar` にまとめてダウンロード
- プライベートプロジェクトは `GITLAB_TOKEN`、または UI で一時的に入力する Personal Access Token に対応
- GitLab からのファイルはストリーミングで S3 (MinIO) へ保存し、受信バイト数を SSE で通知

#### API
- `POST /api/gitlab/releases` … `{ project, token? }` → リリースタグとアセットファイル候補
- `POST /api/gitlab/start` … ZIP: `{ project, target: "archive", ref?, token? }` / リリースアセット: `{ project, target: "release-asset", releaseTag, assetNames: string[], token? }` → `{ jobId }`
- `GET /api/build/progress?jobId=...` … SSE
- `GET /api/build/download?jobId=...` … ZIPまたはリリースアセットをダウンロード

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
