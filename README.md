# Student download-only emergency public site

公開側には原則として次だけを残します。

- index.html
- sw.js（旧PWAキャッシュ削除用。移行後は削除可）
- .nojekyll
- downloads/eiken4_vocabulary.xlsx

旧講師アプリの以下のファイルは公開リポジトリから削除してください。

- app.js
- styles.css
- manifest.webmanifest
- data/
- source/
- tools/
- icons/
- ROADMAP.md
- 講師用マスターや問題DB

## 即時切替

このフォルダの中身で公開リポジトリのルートを置き換え、commit / pushしてください。

旧Service Workerが残る端末では最初の1回だけ古い画面が見える可能性があります。
その場合は再読み込みしてください。新しい sw.js と index.html が旧キャッシュを削除します。
