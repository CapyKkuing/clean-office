# 배포용 APK 서명 (비밀번호는 이 창에서 직접 입력 — 파일·기록에 남지 않음)
# 사용: powershell -ExecutionPolicy Bypass -File tools\sign-release.ps1
param(
  [string]$Keystore = "$env:USERPROFILE\.android\clean-office-release.jks",
  [string]$Alias = "cleanoffice",
  [string]$Jdk = "C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot",
  [string]$Sdk = "$env:LOCALAPPDATA\Android\Sdk"
)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$version = (Get-Content "$root\package.json" -Raw | ConvertFrom-Json).version
$bt = Get-ChildItem "$Sdk\build-tools" | Sort-Object { [version]($_.Name -replace '-.*$', '') } | Select-Object -Last 1
$unsigned = "$root\android\app\build\outputs\apk\release\app-release-unsigned.apk"
$aligned = "$root\android\app\build\outputs\apk\release\app-release-aligned.apk"
$outDir = "$root\release"
$out = "$outDir\CleanOffice-$version.apk"

if (-not (Test-Path $unsigned)) { throw "먼저 배포용 빌드를 하세요: cd android; .\gradlew.bat assembleRelease" }

if (-not (Test-Path $Keystore)) {
  Write-Host ""
  Write-Host "서명 키가 없어 새로 만듭니다: $Keystore" -ForegroundColor Cyan
  Write-Host "비밀번호를 정해 두 번 입력하세요 (6자 이상). 화면에 글자가 안 보이는 게 정상입니다." -ForegroundColor Cyan
  Write-Host "※ 이 키와 비밀번호를 잃어버리면 앱 업데이트를 더 이상 낼 수 없습니다. 꼭 따로 보관하세요." -ForegroundColor Yellow
  & "$Jdk\bin\keytool.exe" -genkeypair -keystore $Keystore -alias $Alias -keyalg RSA -keysize 4096 -validity 10000 -storetype PKCS12 -dname "CN=CapyKkuing, O=Clean Office"
  if ($LASTEXITCODE -ne 0) { throw "키 만들기 실패" }
}

& "$($bt.FullName)\zipalign.exe" -f -p 4 $unsigned $aligned
New-Item -ItemType Directory -Force $outDir | Out-Null
Write-Host ""
Write-Host "APK에 서명합니다. 서명 키 비밀번호를 입력하세요." -ForegroundColor Cyan
$env:JAVA_HOME = $Jdk
& "$($bt.FullName)\apksigner.bat" sign --ks $Keystore --ks-key-alias $Alias --out $out $aligned
if ($LASTEXITCODE -ne 0) { throw "서명 실패 (비밀번호 확인)" }
& "$($bt.FullName)\apksigner.bat" verify --print-certs $out | Select-String "Signer #1 certificate DN|SHA-256"
Remove-Item $aligned -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "완료: $out" -ForegroundColor Green
