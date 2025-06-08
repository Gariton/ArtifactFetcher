# Dockerイメージ取得スクリプト

このリポジトリには、Docker Hubからイメージをダウンロードし、
ローカル環境に展開するためのNode.jsスクリプトが含まれています。

## 前提条件
- Node.jsが実行できる環境
- `npm install`で依存パッケージ(`axios`, `progress`, `tar`)をインストール済みであること

## 使い方
### 1. Dockerイメージのダウンロード
```
npm run download -- <リポジトリ名> <タグ>
```
例: `ubuntu:latest` を取得する場合
```
npm run download -- library/ubuntu latest
```
ダウンロードが完了すると、`downloads/<リポジトリ名>@<タグ>.tar` が生成されます。

### 2. OCI形式でダウンロードする場合
プラットフォームを指定してダウンロードしたい場合は次のコマンドを使用します。
```
npm run download_oci -- <リポジトリ名> <タグ> [プラットフォーム]
```
例: `linux/arm64` を指定
```
npm run download_oci -- library/ubuntu latest linux/arm64
```

### 3. Bearerトークンの取得
```
npm run bearer -- <リポジトリ名>
```

## 出力物
- `downloads/` ディレクトリにイメージを展開したファイルと `manifest.json` が生成されます。
- さらに `downloads/<リポジトリ名>@<タグ>.tar` にまとめられ、 `docker load -i` で読み込み可能です。

## ライセンス
このリポジトリのコードはMITライセンスです。
