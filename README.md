# eiken4-vocabulary01
GitHub Pages だけで動く、英検4級語彙学習Webアプリです。

## 収録データ
- 単語: 889語
- 熟語・表現: 103項目
- 合計: 992項目

## 主な機能
- 今日の10問（弱点・復習期限・未学習を自動選択）
- 固定10語セット
- ランダム10問
- 英語→日本語 4択
- 名詞の可算性 C / U / C/U 等の4択
- 熟語・表現テスト
- 学習カード
- 間違いだけ再テスト
- localStorage による進捗・弱点・履歴保存
- 綴り想起・意味認識・可算性を別スキルとして記録（可算性正解だけで語彙定着扱いにしない）
- 進捗のJSON書き出し／読み込み
- 単語検索・フィルタ
- PWA / オフライン対応
- Excel版ダウンロード

## 保存について
学習進捗はサーバーには送信せず、そのブラウザの `localStorage` に保存します。
端末間の自動同期はありません。進捗ページからJSONを書き出して移行できます。

## GitHub Pagesへの公開
このフォルダの中身をリポジトリ直下へ置きます。

Settings → Pages → Deploy from a branch → main → /(root)

相対パスだけで構成しているため、`username.github.io/repository-name/` 型のProject Pagesで動作します。

## Excelを更新したとき
1. `downloads/eiken4_vocabulary.xlsx` を最新版に置き換える
2. リポジトリのルートで以下を実行

```bash
python tools/build_data.py downloads/eiken4_vocabulary.xlsx
```

3. `data/data.js` とExcelをcommit/push

Webアプリ側を手で編集せず、Excelをマスターとして運用できます。
