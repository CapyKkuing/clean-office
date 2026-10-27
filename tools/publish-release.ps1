# 서명된 APK를 깃허브 릴리스로 올림 (sign-release.ps1 다음에 실행)
# - CleanOffice-<버전>.apk 와, QR 고정 주소용 CleanOffice.apk 두 개를 올림
#   고정 주소: https://github.com/CapyKkuing/clean-office/releases/latest/download/CleanOffice.apk
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$version = (Get-Content "$root\package.json" -Raw | ConvertFrom-Json).version
$apk = "$root\release\CleanOffice-$version.apk"
$fixed = "$root\release\CleanOffice.apk"
$notes = "$root\docs\release-notes\v$version.md"
if (-not (Test-Path $apk)) { throw "서명된 APK가 없습니다: $apk (먼저 tools\sign-release.ps1)" }
if (-not (Test-Path $notes)) { throw "릴리스 설명이 없습니다: $notes" }
Copy-Item $apk $fixed -Force
$hash = (Get-FileHash $apk -Algorithm SHA256).Hash.ToLower()
$body = (Get-Content $notes -Raw -Encoding UTF8) + "`n`nAPK SHA-256: ``$hash``"
$tmp = [IO.Path]::GetTempFileName()
[IO.File]::WriteAllText($tmp, $body, (New-Object Text.UTF8Encoding $false))
Write-Host "릴리스 v$version 올리는 중..." -ForegroundColor Cyan
gh release create "v$version" $apk $fixed --repo CapyKkuing/clean-office --title "클린오피스 $version" --notes-file $tmp --latest
Remove-Item $tmp
if ($LASTEXITCODE -ne 0) { throw "릴리스 실패" }
Write-Host "완료: https://github.com/CapyKkuing/clean-office/releases/tag/v$version" -ForegroundColor Green
