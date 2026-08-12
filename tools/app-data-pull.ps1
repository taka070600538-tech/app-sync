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
    # 時間管理ダイアリーの記録を01_日記の該当日ファイルへ転記する(冪等)
    $timeDiaryTranscribe = "D:\Obsidian Vault for Claude Code\Git\time-diary-app\tools\transcribe.mjs"
    if (Test-Path $timeDiaryTranscribe) {
        $tdOut = node $timeDiaryTranscribe | Out-String
        Add-Content -Path $log -Value "[$stamp] 日記転記(時間管理ダイアリー): $($tdOut.Trim())" -Encoding UTF8
    }
    # 声日記の記録を01_日記の該当日ファイルへ転記する(冪等)
    $voiceDiaryTranscribe = "D:\Obsidian Vault for Claude Code\Git\voice-diary-app\tools\transcribe.mjs"
    if (Test-Path $voiceDiaryTranscribe) {
        $vdOut = node $voiceDiaryTranscribe | Out-String
        Add-Content -Path $log -Value "[$stamp] 日記転記(声日記): $($vdOut.Trim())" -Encoding UTF8
    }
    # 通話録音リポジトリをpullする(録音日記と音声がVaultへ届く)
    $crRepo = "D:\Obsidian Vault for Claude Code\Git\call-recording-app"
    $crOut = git -C $crRepo pull 2>&1 | Out-String
    Add-Content -Path $log -Value "[$stamp] 通話録音pull: $($crOut.Trim())" -Encoding UTF8
} catch {
    Add-Content -Path $log -Value "[$stamp] ERROR: $($_.Exception.Message)" -Encoding UTF8
}



