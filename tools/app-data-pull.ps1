# app-dataリポジトリを毎日pullする(タスクスケジューラAppDataGitPullから実行)
$repo = "D:\Obsidian Vault for Claude Code\Git\app-data"
$log = Join-Path $repo "pull-log.txt"
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
try {
    $output = git -C $repo pull 2>&1 | Out-String
    Add-Content -Path $log -Value "[$stamp] OK: $($output.Trim())" -Encoding UTF8
    # 運動管理アプリの記録を01_日記の該当日ファイルへ転記する(冪等)
    $transcribe = node "D:\Obsidian Vault for Claude Code\Git\運動管理アプリ\tools\transcribe-diary.mjs" 2>&1 | Out-String
    Add-Content -Path $log -Value "[$stamp] 日記転記: $($transcribe.Trim())" -Encoding UTF8
} catch {
    Add-Content -Path $log -Value "[$stamp] ERROR: $($_.Exception.Message)" -Encoding UTF8
}


