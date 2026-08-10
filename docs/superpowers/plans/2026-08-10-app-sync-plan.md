# アプリ共通GitHub自動バックアップ基盤 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **注意:** Task 3・5・6はユーザーのGitHub/PAT操作とControllerのブラウザ操作を含むため、**inline実行(executing-plans)を推奨**する。

**Goal:** 個人用PWA群の記録データを1日1回GitHubに自動保存し、PCに自動同期する共通基盤を作り、カロリー計算アプリに組み込む。

**Architecture:** 共有モジュール`v1/sync.js`を公開リポジトリ`app-sync`のGitHub Pagesで配信し、各アプリが動的importする。データは非公開リポジトリ`app-data`にContents APIで保存(アプリごとにフォルダ)。PCはタスクスケジューラで日次pull。

**Tech Stack:** 素のESM(外部ライブラリなし)、GitHub Contents API、node:test、Windowsタスクスケジューラ + PowerShell

## Global Constraints

- 外部ライブラリ・ビルドツールは一切追加しない
- テストは `node --test tests/*.test.js`(ESM、`node:test` + `assert/strict`)
- モジュールはトップレベルでbrowserグローバル(localStorage/document/fetch)に触れない(node:testでimportできるようにするため。関数本体内はOK)
- PAT(トークン)をコード・コミット・チャットに一切含めない。ユーザー自身がアプリの設定画面から入力する
- カロリーアプリ側: パスは相対(`./`)のまま、JSファイル追加時は`sw.js`の`ASSETS`と`CACHE_NAME`を更新(今回は`calorie-app-v8`)
- コミットメッセージは既存の慣習(`feat:`/`test:`/`docs:` + 日本語)に従う
- データリポジトリ: `taka070600538-tech/app-data`(非公開)。共有モジュール配信URL: `https://taka070600538-tech.github.io/app-sync/v1/sync.js`

---

### Task 1: sync.jsの純粋ヘルパー(app-syncリポジトリ)

**Files:**
- Create: `D:\Obsidian Vault for Claude Code\Git\app-sync\package.json`
- Create: `D:\Obsidian Vault for Claude Code\Git\app-sync\v1\sync.js`(純粋ヘルパー部分のみ)
- Test: `D:\Obsidian Vault for Claude Code\Git\app-sync\tests\sync.test.js`

**Interfaces:**
- Produces: `utf8ToBase64(str)` / `base64ToUtf8(b64)`(UTF-8対応base64変換)、`todayString(now?)`(ローカル日付'YYYY-MM-DD')、`shouldBackupToday(lastBackupIso, today)`(最終保存のISO文字列と今日の日付文字列を比較しbooleanを返す)。Task 2のブラウザロジックとTask 4のテストが使う。

- [ ] **Step 1: package.jsonを作る**

```json
{
  "name": "app-sync",
  "private": true,
  "type": "module"
}
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/sync.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { utf8ToBase64, base64ToUtf8, todayString, shouldBackupToday } from '../v1/sync.js';

test('utf8ToBase64/base64ToUtf8: 日本語を含む文字列が往復で一致する', () => {
  const original = '{"食品":"ごはん","kcal":168}';
  assert.equal(base64ToUtf8(utf8ToBase64(original)), original);
});

test('utf8ToBase64: ASCII文字列はbtoaと同じ結果になる', () => {
  assert.equal(utf8ToBase64('hello'), 'aGVsbG8=');
});

test('base64ToUtf8: GitHub APIが返す改行入りbase64も処理できるよう呼び出し側で改行除去する前提の生base64を扱う', () => {
  const b64 = utf8ToBase64('テスト');
  assert.equal(base64ToUtf8(b64), 'テスト');
});

test('todayString: ローカル日付をYYYY-MM-DDで返す', () => {
  assert.equal(todayString(new Date(2026, 7, 10, 23, 59)), '2026-08-10');
  assert.equal(todayString(new Date(2026, 0, 5, 0, 0)), '2026-01-05');
});

test('shouldBackupToday: 最終保存がnullなら保存する', () => {
  assert.equal(shouldBackupToday(null, '2026-08-10'), true);
});

test('shouldBackupToday: 最終保存が今日ならスキップする', () => {
  const todayNoon = new Date(2026, 7, 10, 12, 0).toISOString();
  assert.equal(shouldBackupToday(todayNoon, '2026-08-10'), false);
});

test('shouldBackupToday: 最終保存が昨日なら保存する', () => {
  const yesterday = new Date(2026, 7, 9, 23, 0).toISOString();
  assert.equal(shouldBackupToday(yesterday, '2026-08-10'), true);
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `cd "D:\Obsidian Vault for Claude Code\Git\app-sync" && node --test tests/sync.test.js`
Expected: FAIL(`v1/sync.js`が存在しない)

- [ ] **Step 4: 純粋ヘルパーを実装する**

`v1/sync.js`(この段階ではここまで):

```js
// app-sync v1 — アプリ共通GitHub自動バックアップ基盤の共有モジュール。
// 全アプリが https://taka070600538-tech.github.io/app-sync/v1/sync.js からimportする。
// トップレベルではブラウザグローバルに触れない(node:testでimportするため)。
const DATA_REPO = 'taka070600538-tech/app-data';
const API_BASE = `https://api.github.com/repos/${DATA_REPO}/contents/`;
const KEY_TOKEN = 'app-sync:token';
const KEY_LAST_PREFIX = 'app-sync:lastBackup:';

export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function base64ToUtf8(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function todayString(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// lastBackupIsoはISO 8601文字列(UTC)。ローカル日付に直して今日と比較する。
export function shouldBackupToday(lastBackupIso, today) {
  if (!lastBackupIso) return true;
  return todayString(new Date(lastBackupIso)) !== today;
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `node --test tests/sync.test.js`
Expected: 7件PASS

- [ ] **Step 6: コミット**

```bash
git add package.json v1/sync.js tests/sync.test.js
git commit -m "feat: 共有モジュールの純粋ヘルパー(base64/日付/日次判定)を追加する"
```

---

### Task 2: sync.jsのブラウザロジックとREADME(app-syncリポジトリ)

**Files:**
- Modify: `D:\Obsidian Vault for Claude Code\Git\app-sync\v1\sync.js`(末尾に追加)
- Create: `D:\Obsidian Vault for Claude Code\Git\app-sync\README.md`

**Interfaces:**
- Consumes: Task 1のヘルパー
- Produces: `initDailyBackup({ appId, collect, restore })`(起動時に呼ぶ。その日未保存なら自動保存)、`renderSyncSettings(container)`(設定UI描画)、`backupNow()` / `restoreFromGitHub()`(いずれも`{ ok: boolean, message: string }`を返す)。Task 4のカロリーアプリが使う。

- [ ] **Step 1: ブラウザロジックを実装する**

`v1/sync.js`の末尾に追加:

```js
// ---- ここからブラウザ専用(localStorage / fetch / DOM) ----

let config = null;

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
}

function getToken() {
  return localStorage.getItem(KEY_TOKEN);
}

function getLastBackup(appId) {
  return localStorage.getItem(KEY_LAST_PREFIX + appId);
}

// アプリ起動時に呼ぶ。collectは全データのオブジェクトを返すasync関数、
// restoreはそのオブジェクトをDBに書き戻すasync関数。
export function initDailyBackup({ appId, collect, restore }) {
  config = { appId, collect, restore };
  maybeBackupToday().catch(() => {}); // 失敗しても静かにスキップ(次回起動時に再試行)
}

async function maybeBackupToday() {
  if (!getToken()) return;
  if (!shouldBackupToday(getLastBackup(config.appId), todayString())) return;
  await backupNow();
}

// 404はnull、成功はJSON、それ以外は例外。
async function fetchRemote(token, path) {
  const res = await fetch(API_BASE + path, { headers: authHeaders(token), cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHubへのアクセスに失敗しました(${res.status})`);
  return res.json();
}

async function putContents(token, path, content) {
  const existing = await fetchRemote(token, path);
  return fetch(API_BASE + path, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({
      message: `backup: ${path} ${todayString()}`,
      content,
      ...(existing ? { sha: existing.sha } : {}),
    }),
  });
}

export async function backupNow() {
  if (!config) throw new Error('initDailyBackupが呼ばれていません');
  const token = getToken();
  if (!token) return { ok: false, message: 'トークンが未設定です' };
  try {
    const path = `${config.appId}/backup.json`;
    const content = utf8ToBase64(JSON.stringify(await config.collect(), null, 2));
    let res = await putContents(token, path, content);
    // sha競合(同日に他端末が書いた等)は最新shaを取り直して1回だけ再試行
    if (res.status === 409 || res.status === 422) res = await putContents(token, path, content);
    if (!res.ok) return { ok: false, message: `保存に失敗しました(${res.status})` };
    localStorage.setItem(KEY_LAST_PREFIX + config.appId, new Date().toISOString());
    return { ok: true, message: '保存しました' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

export async function restoreFromGitHub() {
  if (!config) throw new Error('initDailyBackupが呼ばれていません');
  const token = getToken();
  if (!token) return { ok: false, message: 'トークンが未設定です' };
  try {
    const existing = await fetchRemote(token, `${config.appId}/backup.json`);
    if (!existing) return { ok: false, message: 'バックアップがまだありません' };
    const data = JSON.parse(base64ToUtf8(existing.content.replace(/\n/g, '')));
    await config.restore(data);
    return { ok: true, message: '復元しました。ページを再読み込みします' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

export function renderSyncSettings(container) {
  const hasToken = !!getToken();
  const last = config ? getLastBackup(config.appId) : null;
  container.innerHTML = `
    <h3 class="settings-heading">バックアップ(GitHub)</h3>
    <p class="settings-note">1日1回、アプリを開いたときに自動保存されます。
      状態: ${hasToken ? 'トークン設定済み' : 'トークン未設定'} /
      最終保存: ${last ? new Date(last).toLocaleString('ja-JP') : 'なし'}</p>
    <label>Personal Access Token
      <input type="password" id="sync-token" placeholder="${hasToken ? '(設定済み。変更時のみ入力)' : 'github_pat_...'}"></label>
    <button type="button" id="sync-save-token">トークンを保存</button>
    <button type="button" id="sync-backup-now">今すぐ保存</button>
    <button type="button" id="sync-restore">GitHubから復元</button>
    <span id="sync-status"></span>
  `;
  const status = container.querySelector('#sync-status');
  container.querySelector('#sync-save-token').addEventListener('click', () => {
    const value = container.querySelector('#sync-token').value.trim();
    if (!value) { status.textContent = 'トークンを入力してください'; return; }
    localStorage.setItem(KEY_TOKEN, value);
    renderSyncSettings(container); // 状態表示を更新
  });
  container.querySelector('#sync-backup-now').addEventListener('click', async () => {
    status.textContent = '保存中...';
    const result = await backupNow();
    if (result.ok) { renderSyncSettings(container); return; }
    status.textContent = result.message;
  });
  container.querySelector('#sync-restore').addEventListener('click', async () => {
    if (!confirm('この端末の現在のデータを、GitHub上のバックアップで上書きします。よろしいですか?')) return;
    status.textContent = '復元中...';
    const result = await restoreFromGitHub();
    status.textContent = result.message;
    if (result.ok) setTimeout(() => location.reload(), 800);
  });
}
```

- [ ] **Step 2: node:testでのimportが壊れていないことを確認する**

Run: `node --test tests/sync.test.js`
Expected: 7件PASS(追加コードがトップレベルでブラウザグローバルに触れていない証明)

- [ ] **Step 3: READMEを書く**

`README.md`:

```markdown
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
```

- [ ] **Step 4: コミット**

```bash
git add v1/sync.js README.md
git commit -m "feat: バックアップ・復元・設定UIのブラウザロジックとREADMEを追加する"
```

---

### Task 3: GitHubリポジトリ2つの作成と公開

**Files:** なし(git/GitHub操作のみ)

**Interfaces:**
- Consumes: Task 1-2のapp-syncリポジトリ(ローカル)
- Produces: 公開URL `https://taka070600538-tech.github.io/app-sync/v1/sync.js`(Task 4以降が使う)、非公開リポジトリ `app-data`(mainブランチ、README初期化済み)

- [ ] **Step 1: ユーザーにリポジトリ2つの作成を依頼する**

`gh` CLIが無いため、ユーザーに以下を依頼して完了を待つ:

> https://github.com/new で2つ作成してください:
> 1. `app-sync` — **Public**、README等は**追加しない**(空のまま)
> 2. `app-data` — **Private**、**「Add a README file」にチェックを入れる**(ブランチを初期化するため)

- [ ] **Step 2: app-syncをpushする**

```bash
cd "D:\Obsidian Vault for Claude Code\Git\app-sync"
git remote add origin https://github.com/taka070600538-tech/app-sync.git
git push -u origin master
```

- [ ] **Step 3: ユーザーにPages有効化を依頼する**

> app-syncリポジトリの Settings → Pages → Source: **Deploy from a branch** →
> Branch: **master** / **(root)** で Save してください。

- [ ] **Step 4: 配信を確認する**

デプロイ完了(1〜2分)後、Browserパネルで
`https://taka070600538-tech.github.io/app-sync/v1/sync.js` を開き、
モジュールのソースが表示されることを確認する。さらに`javascript_tool`で:

```js
(async () => {
  const mod = await import('https://taka070600538-tech.github.io/app-sync/v1/sync.js');
  return JSON.stringify(Object.keys(mod));
})()
```

Expected: `utf8ToBase64` / `base64ToUtf8` / `todayString` / `shouldBackupToday` / `initDailyBackup` / `renderSyncSettings` / `backupNow` / `restoreFromGitHub` を含む配列

---

### Task 4: カロリーアプリへの組み込み

worktree(`superpowers:using-git-worktrees`の慣習に従い`.claude/worktrees/`配下)で作業し、完了後にmasterへマージする。

**Files:**
- Create: `js/backup.js`
- Modify: `js/db.js`(`getAllMeals`を追加)
- Modify: `js/settings.js`(バックアップセクションを追加)
- Modify: `js/app.js`(`init()`の末尾で`initDailyBackup`)
- Modify: `sw.js`(`ASSETS`に`./js/backup.js`追加、`CACHE_NAME`を`calorie-app-v8`に)
- Modify: `README.md`(バックアップの説明を追加)
- Test: `tests/backup.test.js`

**Interfaces:**
- Consumes: Task 2の`initDailyBackup` / `renderSyncSettings`(動的import)、既存の`js/db.js`の`getAllFoods(db)` / `getGoals(db)` / `promisifyRequest`パターン
- Produces: `collectBackup(db)`(`{version, exportedAt, foods, meals, goals}`を返す)、`restoreBackup(db, data)`、純粋関数`buildBackupPayload({foods, meals, goals}, now?)` / `validateBackupData(data)`

- [ ] **Step 1: 失敗するテストを書く**

`tests/backup.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackupPayload, validateBackupData } from '../js/backup.js';

const sample = {
  foods: [{ id: 'custom_1', name: 'ごはん', kcal: 168 }],
  meals: [{ id: 1, date: '2026-08-10', mealType: 'breakfast', foodId: 'custom_1', amount: 150 }],
  goals: { id: 'default', kcal: 2000, protein: 60, fat: 60, carb: 250, salt: 7, expenditureKcal: 2100 },
};

test('buildBackupPayload: version 1とexportedAtと全データを含む', () => {
  const now = new Date(2026, 7, 10, 12, 0);
  const payload = buildBackupPayload(sample, now);
  assert.equal(payload.version, 1);
  assert.equal(payload.exportedAt, now.toISOString());
  assert.deepEqual(payload.foods, sample.foods);
  assert.deepEqual(payload.meals, sample.meals);
  assert.deepEqual(payload.goals, sample.goals);
});

test('validateBackupData: buildBackupPayloadの出力をそのまま受理する(往復)', () => {
  const payload = buildBackupPayload(sample);
  assert.equal(validateBackupData(payload), payload);
});

test('validateBackupData: versionが違えば例外', () => {
  const bad = { ...buildBackupPayload(sample), version: 2 };
  assert.throws(() => validateBackupData(bad), /version/);
});

test('validateBackupData: foodsが配列でなければ例外', () => {
  const bad = { ...buildBackupPayload(sample), foods: null };
  assert.throws(() => validateBackupData(bad), /foods/);
});

test('validateBackupData: goalsがオブジェクトでなければ例外', () => {
  const bad = { ...buildBackupPayload(sample), goals: null };
  assert.throws(() => validateBackupData(bad), /goals/);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node --test tests/backup.test.js`
Expected: FAIL(`js/backup.js`が存在しない)

- [ ] **Step 3: js/db.jsにgetAllMealsを追加する**

`getMealsByDateRange`の直後に:

```js
export async function getAllMeals(db) {
  const tx = db.transaction('meals', 'readonly');
  return promisifyRequest(tx.objectStore('meals').getAll());
}
```

- [ ] **Step 4: js/backup.jsを実装する**

```js
import { getAllFoods, getAllMeals, getGoals } from './db.js';

export function buildBackupPayload({ foods, meals, goals }, now = new Date()) {
  return { version: 1, exportedAt: now.toISOString(), foods, meals, goals };
}

export function validateBackupData(data) {
  if (!data || data.version !== 1) throw new Error('バックアップデータの形式が不正です(version)');
  if (!Array.isArray(data.foods)) throw new Error('バックアップデータの形式が不正です(foods)');
  if (!Array.isArray(data.meals)) throw new Error('バックアップデータの形式が不正です(meals)');
  if (typeof data.goals !== 'object' || data.goals === null) throw new Error('バックアップデータの形式が不正です(goals)');
  return data;
}

export async function collectBackup(db) {
  const [foods, meals, goals] = await Promise.all([getAllFoods(db), getAllMeals(db), getGoals(db)]);
  return buildBackupPayload({ foods, meals, goals });
}

export async function restoreBackup(db, data) {
  validateBackupData(data);
  const tx = db.transaction(['foods', 'meals', 'goals'], 'readwrite');
  tx.objectStore('foods').clear();
  tx.objectStore('meals').clear();
  tx.objectStore('goals').clear();
  for (const food of data.foods) tx.objectStore('foods').put(food);
  for (const meal of data.meals) tx.objectStore('meals').put(meal);
  tx.objectStore('goals').put({ ...data.goals, id: 'default' });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `node --test tests/*.test.js`
Expected: 全件PASS(既存72件 + 新規5件 = 77件)

- [ ] **Step 6: js/app.jsのinit()末尾に自動バックアップを組み込む**

`js/app.js`のimport部に追加:

```js
import { collectBackup, restoreBackup } from './backup.js';
```

`init()`の`navigator.serviceWorker.register`ブロックの直後(関数の最後)に追加:

```js
  // 共有モジュールは動的import。オフラインやapp-sync障害時は黙ってスキップし、
  // アプリ本体の起動を妨げない(次回オンライン起動時に再試行される)。
  import('https://taka070600538-tech.github.io/app-sync/v1/sync.js')
    .then((sync) => sync.initDailyBackup({
      appId: 'calorie-app',
      collect: () => collectBackup(state.db),
      restore: (data) => restoreBackup(state.db, data),
    }))
    .catch(() => {});
```

- [ ] **Step 7: js/settings.jsにバックアップセクションを追加する**

`renderSettingsView`の末尾(`form.addEventListener`ブロックの後)に追加:

```js
  const backupSection = document.createElement('div');
  backupSection.id = 'backup-section';
  container.appendChild(backupSection);
  import('https://taka070600538-tech.github.io/app-sync/v1/sync.js')
    .then((sync) => sync.renderSyncSettings(backupSection))
    .catch(() => {
      backupSection.innerHTML = '<p class="settings-note">バックアップ機能は現在利用できません(オフラインの可能性)。</p>';
    });
```

- [ ] **Step 8: sw.jsを更新する**

```js
const CACHE_NAME = 'calorie-app-v8';
```

`ASSETS`の`'./js/analyticsView.js',`の後に追加:

```js
  './js/backup.js',
```

(共有モジュールのURLは方針どおり**ASSETSに入れない**)

- [ ] **Step 9: READMEにバックアップの説明を追加する**

「スマホにインストールする」セクションの後に:

```markdown
## バックアップと復元

設定タブでGitHubのPersonal Access Token(fine-grained、対象リポジトリ=app-dataのみ、
権限=Contents: Read and write)を保存すると、1日1回、アプリを開いたときに
全データ(食品・食事記録・目標)が非公開リポジトリ `app-data` の
`calorie-app/backup.json` に自動保存される。過去のバックアップはgitのコミット履歴に残る。

機種変更・復元するときは、新しい端末でアプリを開き、設定タブでトークンを入力して
「GitHubから復元」を押す。

仕組みは共通基盤 [app-sync](https://github.com/taka070600538-tech/app-sync) を参照。
```

- [ ] **Step 10: 全テスト確認とローカル動作確認**

Run: `node --test tests/*.test.js` → Expected: 77件PASS

ローカルサーバーでアプリを開き、`javascript_tool`で確認:
- 設定タブに「バックアップ(GitHub)」セクションが表示される(トークン未設定表示)
- consoleにエラーが出ていない(`read_console_messages`)

- [ ] **Step 11: コミットしてmasterへマージ**

```bash
git add js/backup.js js/db.js js/app.js js/settings.js sw.js README.md tests/backup.test.js
git commit -m "feat: app-sync共通基盤による1日1回のGitHub自動バックアップと復元を追加する"
```

マージ方法はユーザーに確認してから(finishing-a-development-branchの流儀)、
masterへマージし`git push`する(GitHub Pagesに反映)。

---

### Task 5: E2E確認(PAT設定と実データでの保存・復元)

**Files:** なし(公開環境での確認)

**Interfaces:**
- Consumes: Task 3の公開モジュール、Task 4のデプロイ済みカロリーアプリ

- [ ] **Step 1: ユーザーにPATの発行を依頼する**

> https://github.com/settings/personal-access-tokens/new で発行してください:
> - Token name: `app-sync`(任意)
> - Expiration: 最長(1年)を推奨
> - Repository access: **Only select repositories** → `app-data` のみ
> - Permissions → Repository permissions → **Contents: Read and write**
> 発行されたトークン(`github_pat_...`)は**チャットに貼らず**、
> 次のステップでアプリの設定画面に直接入力してください。

- [ ] **Step 2: ユーザーにPC(またはスマホ)のブラウザでトークン設定と保存を依頼する**

> https://taka070600538-tech.github.io/calorie-app/ を開き、
> 設定タブ → バックアップ(GitHub)→ トークンを貼り付けて「トークンを保存」→
> 「今すぐ保存」を押してください。「保存しました」と出たら成功です。

- [ ] **Step 3: app-dataにバックアップが作られたことを確認する**

ユーザーに https://github.com/taka070600538-tech/app-data を開いてもらい、
`calorie-app/backup.json` が存在しコミットが増えていることを確認してもらう
(app-dataは非公開のためControllerのブラウザでは見えない)。

- [ ] **Step 4: 復元の動作確認(ユーザーと協働)**

> 同じページのdevtoolsコンソールで `indexedDB.deleteDatabase('calorie-app-db')` を
> 実行してから再読み込みし(データが消えた状態を確認)、
> 設定タブ →「GitHubから復元」を押してください。
> 再読み込み後、記録が戻っていれば復元成功です。

(またはControllerがBrowserパネルで公開URLを開き、`javascript_tool`でIndexedDBを
検査して復元結果を確認する。**トークンの入力だけは必ずユーザーが行う**)

- [ ] **Step 5: スマホでのトークン設定を案内する**

> スマホのカロリー計算アプリでも設定タブでトークンを入力してください
> (localStorageは端末ごとなので、端末ごとに1回だけ入力が必要です。
> 同じ端末の他のアプリには自動で効きます)。

---

### Task 6: PC側の日次自動pull

**Files:**
- Create: `D:\Obsidian Vault for Claude Code\Git\app-sync\tools\app-data-pull.ps1`
- Create(clone): `D:\Obsidian Vault for Claude Code\Git\app-data`

**Interfaces:**
- Consumes: Task 3の`app-data`リポジトリ(mainブランチ)
- Produces: タスクスケジューラ`AppDataGitPull`(毎日06:30、`StartWhenAvailable`)、ログ`Git\app-data\pull-log.txt`

- [ ] **Step 1: app-dataをcloneする**

```bash
git clone https://github.com/taka070600538-tech/app-data.git "D:\Obsidian Vault for Claude Code\Git\app-data"
```

- [ ] **Step 2: pullスクリプトを書く**

`tools/app-data-pull.ps1`(**BOM付きUTF-8で保存すること**。Windows PowerShell 5.1は
BOM無しだとANSIで読み、日本語パスが壊れる):

```powershell
# app-dataリポジトリを毎日pullする(タスクスケジューラAppDataGitPullから実行)
$repo = "D:\Obsidian Vault for Claude Code\Git\app-data"
$log = Join-Path $repo "pull-log.txt"
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
try {
    $output = git -C $repo pull 2>&1 | Out-String
    Add-Content -Path $log -Value "[$stamp] OK: $($output.Trim())" -Encoding UTF8
} catch {
    Add-Content -Path $log -Value "[$stamp] ERROR: $($_.Exception.Message)" -Encoding UTF8
}
```

手順: まずWriteツールで上記内容を`tools/app-data-pull.ps1`に書き、その後PowerShellで
同じファイルをBOM付きUTF-8に変換する(WriteツールはBOM無しで書くため。
PS5.1の`Set-Content -Encoding UTF8`はBOM付きで書く):

```powershell
$path = "D:\Obsidian Vault for Claude Code\Git\app-sync\tools\app-data-pull.ps1"
$content = Get-Content -Raw -Encoding UTF8 $path
Set-Content -Path $path -Value $content -Encoding UTF8
```

- [ ] **Step 3: スクリプト単体を手動実行して確認する**

```powershell
powershell -ExecutionPolicy Bypass -File "D:\Obsidian Vault for Claude Code\Git\app-sync\tools\app-data-pull.ps1"
Get-Content "D:\Obsidian Vault for Claude Code\Git\app-data\pull-log.txt" -Tail 3
```

Expected: `[日時] OK: Already up to date.` のような行がログに追記される

- [ ] **Step 4: タスクスケジューラに登録する**

```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument '-NoProfile -ExecutionPolicy Bypass -File "D:\Obsidian Vault for Claude Code\Git\app-sync\tools\app-data-pull.ps1"'
$trigger = New-ScheduledTaskTrigger -Daily -At "06:30"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskName "AppDataGitPull" -Action $action -Trigger $trigger -Settings $settings -Description "app-dataリポジトリの日次pull(アプリ共通バックアップ基盤)"
```

- [ ] **Step 5: タスクの登録確認と手動実行テスト**

```powershell
Start-ScheduledTask -TaskName "AppDataGitPull"
Start-Sleep -Seconds 10
Get-ScheduledTaskInfo -TaskName "AppDataGitPull" | Select-Object LastRunTime, LastTaskResult
Get-Content "D:\Obsidian Vault for Claude Code\Git\app-data\pull-log.txt" -Tail 3
```

Expected: `LastTaskResult: 0`、ログに新しいOK行

- [ ] **Step 6: スクリプトをコミットする**

```bash
cd "D:\Obsidian Vault for Claude Code\Git\app-sync"
git add tools/app-data-pull.ps1
git commit -m "feat: app-dataの日次自動pullスクリプトを追加する(タスクスケジューラAppDataGitPull用)"
git push
```
