# 서명 + 깃허브 릴리스 한 번에 (비밀번호는 이 창에서 직접 입력)
$ErrorActionPreference = "Stop"
& "$PSScriptRoot\sign-release.ps1"
& "$PSScriptRoot\publish-release.ps1"
