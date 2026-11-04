# Có thể sửa bộ lọc tại đây.
$ErrorActionPreference = "Stop"
$CtModelNameFilter = "gemini"

if (
    -not (Get-Variable CtGeminiHeaders -ErrorAction SilentlyContinue) -or
    -not $CtGeminiHeaders["x-goog-api-key"]
) {
    throw "Chua nap key. Chay: . .\scripts\set-gemini-key.ps1"
}

$CtGeminiModels = @()
$CtGeminiPageToken = $null

do {
    $CtGeminiModelsUrl =
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000"

    if ($CtGeminiPageToken) {
        $CtGeminiModelsUrl +=
            "&pageToken=" + [Uri]::EscapeDataString($CtGeminiPageToken)
    }

    $CtGeminiPage = Invoke-RestMethod `
        -Method Get `
        -Uri $CtGeminiModelsUrl `
        -Headers $CtGeminiHeaders `
        -TimeoutSec 30 `
        -ErrorAction Stop

    $CtGeminiModels += @($CtGeminiPage.models)
    $CtGeminiPageToken = $CtGeminiPage.nextPageToken
} while ($CtGeminiPageToken)

$CtSupportedModels = @(
    $CtGeminiModels |
        Where-Object {
            $_.supportedGenerationMethods -contains "generateContent" -and
            $_.name -match $CtModelNameFilter
        } |
        Select-Object name, displayName, inputTokenLimit, outputTokenLimit
)

if ($CtSupportedModels.Count -eq 0) {
    Write-Host "Khong tim thay model phu hop bo loc." -ForegroundColor Yellow
} else {
    $CtSupportedModels | Format-Table -AutoSize
}

# Lưu danh sách để xem lại, không chứa API key.
$CtModelsOutputPath = Join-Path $PSScriptRoot "gemini-models.json"
$CtUtf8 = New-Object System.Text.UTF8Encoding($false)

[System.IO.File]::WriteAllText(
    $CtModelsOutputPath,
    (ConvertTo-Json -InputObject $CtSupportedModels -Depth 5),
    $CtUtf8
)

Write-Host "Da luu danh sach: $CtModelsOutputPath"