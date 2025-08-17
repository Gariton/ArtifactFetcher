# アーティファクト取得スクリプト
このリポジトリには、Docker Hubやnpm registryからイメージをダウンロードし、
ローカル環境に展開するためのNode.jsスクリプトが含まれています。

## 前提条件
- Node.jsが実行できる環境
- `npm install`で依存パッケージをインストール済みであること

## 使い方
### 1. Dockerイメージのダウンロード
```
npm run download -- docker <リポジトリ名> <タグ> [--platform <プラットフォーム>] [--host <downlaoderのURL>] [--out <出力パス>]
```
例: `ubuntu:latest` を取得する場合
```
npm run download -- docker library/ubuntu latest --platform linux/amd64 --host https://downloader.inchiki.cloud
```
ダウンロードが完了すると、`downloads/library_ubuntu-latest.tar` が生成されます。

### 2. npmパッケージのダウンロード
```
npm run download -- npm <リポジトリ名> <タグ> [--host <downlaoderのURL>] [--out <出力パス>]
```
例: `next@^18` を取得する場合
```
npm run download -- npm next ^18 --host https://downloader.inchiki.cloud
```
ダウンロードが完了すると、`downloads/next-^18.tar` が生成されます。


## ライセンス
このリポジトリのコードはMITライセンスです。
