# EIKEN 4 Vocabulary Lab — MVP 2

GitHub Pagesだけで動作する語彙学習Webアプリです。教材編集はExcel、Web側のJSON/JSデータは自動生成、学習ロジックはJavaScriptに分離しています。

## 現在の機能

- 10 / 20 / 30 / 50 / CUSTOM（最大500）/ ENDLESS
- FASTモード：採点後に自動で次の問題へ
- セッション途中終了時も結果を保存
- 優先度 / 分類 / 品詞による出題範囲指定
- SMART / RANDOM / 固定SET / 弱点 / 復習期限
- 日本語→英語入力、英語→日本語4択、可算性4択
- 熟語・表現
- accepted_answers（別綴り・複数許容解答）
- 近似スペル判定（誤答は誤答のまま、近い場合だけフィードバック）
- localStorageによる履歴・定着度保存
- PWA / オフライン対応

## データ設計

```text
source/eiken4_learning_master.xlsx  ← 人間が編集する原本
            ↓
tools/build_data.py
            ↓
data/data.js                       ← Webアプリ用生成データ
            ↓
app.js                             ← 学習ロジック
```

`data/data.js` は原則として直接編集しません。

### Vocabulary_Master

主要フィールド：

- `ID` — 固定ID。**既存IDを変更・再採番しないでください**。学習履歴との紐付けに使います。
- `英単語`
- `日本語`
- `レベル`
- `優先度`
- `主品詞`
- `分類`
- `名詞区分`
- `IPA_US` / `IPA_UK`
- `許容解答` — `;` 区切り。例: `favorite; favourite`
- `例文`
- `コロケーション`
- `語法参照`

### Phrase_Master

熟語・表現用の固定ID、レベル、許容解答、例文等を管理します。

### Question_Master

将来の英検形式問題用です。`status` が `published` の行だけWebデータに出力されます。現在入っている行は `draft` のサンプルなので出題されません。

## Excelを更新したら

リポジトリのルートで：

```bash
python tools/build_data.py
```

その後、次をcommit/pushします。

```text
source/eiken4_learning_master.xlsx
data/data.js
```

## GitHub Pages

リポジトリ直下にこのフォルダの内容を置きます。

`Settings → Pages → Deploy from a branch → main → /(root)`

Project Pages (`username.github.io/repository-name/`) に対応するため、相対パスで構成しています。

## 学習履歴

履歴はブラウザの `localStorage` に保存します。v1と同じ保存キーを維持しているため、既存端末の進捗を引き継げます。進捗画面からJSONで書き出し・読み込みもできます。
