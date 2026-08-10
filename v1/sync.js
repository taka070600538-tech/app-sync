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
