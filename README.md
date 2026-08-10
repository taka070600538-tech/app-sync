# app-sync

個人用PWA群の記録データを1日1回GitHubに自動保存する共通基盤。
共有モジュール `v1/sync.js` をGitHub Pagesで配信する。

- 配信URL: https://taka070600538-tech.github.io/app-sync/v1/sync.js
- データ保存先: 非公開リポジトリ `app-data`(アプリごとに `<appId>/backup.json`)
- 認証: fine-grained PAT(対象=app-dataのみ、権限=Contents: Read and write)。
  各端末で一度だけアプリの設定画面から入力する(localStorageは
  taka070600538-tech.github.io の全アプリで共有される)

## 新しいアプリへの組み込み方

1. アプリ起動時(初期化の最後)に:

    import('https://taka070600538-tech.github.io/app-sync/v1/sync.js')
      .then((sync) => sync.initDailyBackup({
        appId: '<アプリ名>',            // app-data内のフォルダ名になる
        collect: async () => ({ ... }), // 全データをオブジェクトで返す
        restore: async (data) => { ... }, // オブジェクトをDBに書き戻す
      }))
      .catch(() => {}); // オフライン時はスキップ(アプリ本体は動く)

2. 設定画面に:

    import('https://taka070600538-tech.github.io/app-sync/v1/sync.js')
      .then((sync) => sync.renderSyncSettings(コンテナ要素))
      .catch(() => { /* オフライン用の案内を表示 */ });

3. `sw.js` ではこのURLをキャッシュしないこと(オフライン時はどのみち
   保存できず、キャッシュすると更新が届かなくなるため)。

## 破壊的変更をするとき

`v1/` はそのまま残し、`v2/sync.js` を作って各アプリを順次移行する
(全アプリが同時に壊れるのを防ぐ)。後方互換の修正・改良は `v1/` を直接更新してよい。

## テスト

    node --test tests/*.test.js
