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
