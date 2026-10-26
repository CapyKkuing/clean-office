# 서명 키 비밀번호 바꾸기 (영문·숫자만 쓰세요 — 한글이 들어가면 서명 도구가 거부합니다)
param(
  [string]$Keystore = "$env:USERPROFILE\.android\clean-office-release.jks",
  [string]$Jdk = "C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot"
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path $Keystore)) { throw "서명 키 파일이 없습니다: $Keystore" }
Copy-Item $Keystore "$Keystore.bak" -Force
Write-Host ""
Write-Host "1) '키 저장소 비밀번호 입력' → 지금 쓰는(한글 포함) 비밀번호" -ForegroundColor Cyan
Write-Host "2) '새 키 저장소 비밀번호' → 새 비밀번호를 영문 대소문자·숫자로만, 8자 이상, 두 번 입력" -ForegroundColor Cyan
Write-Host "   (백업: $Keystore.bak)" -ForegroundColor DarkGray
& "$Jdk\bin\keytool.exe" -storepasswd -keystore $Keystore -storetype PKCS12
if ($LASTEXITCODE -ne 0) { throw "비밀번호 변경 실패 — 기존 비밀번호가 맞는지 확인하세요. 키 파일은 바뀌지 않았습니다." }
Write-Host ""
Write-Host "완료. 이제 tools\sign-release.ps1 을 다시 실행하고 새 비밀번호를 입력하세요." -ForegroundColor Green
