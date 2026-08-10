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
