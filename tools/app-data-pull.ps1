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

