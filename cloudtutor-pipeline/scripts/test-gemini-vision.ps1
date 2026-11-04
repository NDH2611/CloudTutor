param(
    [string]$ImagePath = (
        Join-Path $PSScriptRoot "..\vision-test.jpg"
    ),

    [string]$Model = "gemini-3.5-flash-lite"
)

$ErrorActionPreference = "Stop"

if (
    -not (Get-Variable CtGeminiHeaders -ErrorAction SilentlyContinue) -or
    -not $CtGeminiHeaders["x-goog-api-key"]
) {
    throw "Chua nap key. Chay: . .\scripts\set-gemini-key.ps1"
}

$CtImageFile = Get-Item -LiteralPath $ImagePath

if ($CtImageFile.PSIsContainer) {
    throw "ImagePath phai la file anh"
}

$CtMimeType = switch ($CtImageFile.Extension.ToLowerInvariant()) {
    ".jpg"  { "image/jpeg" }
    ".jpeg" { "image/jpeg" }
    ".png"  { "image/png" }
    default { throw "Chi chap nhan JPG, JPEG hoac PNG" }
}

# Giới hạn riêng cho phép thử nhỏ này.
if (
    $CtImageFile.Length -eq 0 -or
    $CtImageFile.Length -gt 4MB
) {
    throw "Anh phai co dung luong lon hon 0 va khong qua 4 MB"
}

$CtImageBase64 = [Convert]::ToBase64String(
    [System.IO.File]::ReadAllBytes($CtImageFile.FullName)
)

$CtPrompt = @"
Bạn đang mô tả một khung hình lấy từ video cho hệ thống CloudTutor.
Hãy viết bằng tiếng Việt khoảng 3-5 câu:
- Chỉ mô tả cảnh, đối tượng, bố cục và hoạt động có bằng chứng trong ảnh.
- Không suy đoán âm thanh, danh tính, ý định hoặc diễn biến ngoài khung hình.
- Nếu không nhìn rõ hoặc ảnh không có nội dung hữu ích, nói rõ điều đó.
Không tự đặt mốc thời gian.
"@

$CtRequest = @{
    contents = @(
        @{
            role = "user"
            parts = @(
                @{
                    text = $CtPrompt
                }
                @{
                    inlineData = @{
                        mimeType = $CtMimeType
                        data = $CtImageBase64
                    }
                }
            )
        }
    )

    generationConfig = @{
        temperature = 0.2
        maxOutputTokens = 1024
    }
}

$CtRequestJson = $CtRequest | ConvertTo-Json -Depth 12
$CtRequestBytes = [System.Text.Encoding]::UTF8.GetBytes(
    $CtRequestJson
)

$CtEndpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    "${Model}:generateContent"

Write-Host "Dang thu Vision voi model: $Model"

# Một request, chưa tự retry để dễ kiểm tra lỗi/quota.
try {
    $CtResponse = Invoke-RestMethod `
        -Method Post `
        -Uri $CtEndpoint `
        -Headers $CtGeminiHeaders `
        -ContentType "application/json; charset=utf-8" `
        -Body $CtRequestBytes `
        -TimeoutSec 90 `
        -ErrorAction Stop
} catch {
    Write-Host "Goi Gemini Vision that bai." -ForegroundColor Red

    if ($_.ErrorDetails.Message) {
        Write-Host $_.ErrorDetails.Message
    }

    throw
}

$CtCandidate = @($CtResponse.candidates)[0]

if (
    $null -eq $CtCandidate -or
    $CtCandidate.finishReason -ne "STOP"
) {
    throw (
        "Dau ra chua hoan tat hop le. finishReason={0}; blockReason={1}" -f
        $CtCandidate.finishReason,
        $CtResponse.promptFeedback.blockReason
    )
}

$CtDescription = (
    @(
        $CtCandidate.content.parts |
            Where-Object { $_.text -and -not $_.thought } |
            ForEach-Object { $_.text }
    ) -join "`n"
).Trim()

if ([string]::IsNullOrWhiteSpace($CtDescription)) {
    throw "Gemini khong tra ve van ban mo ta"
}

$CtOutput = @{
    model = $Model
    image_file = $CtImageFile.Name
    source = "VISION"
    description = $CtDescription
    warnings = @("AI_GENERATED_VISUAL_DESCRIPTION")
    usage_metadata = $CtResponse.usageMetadata
    tested_at = [DateTime]::UtcNow.ToString("o")
}

$CtOutputPath = Join-Path $PSScriptRoot "vision-test-result.json"
$CtUtf8 = New-Object System.Text.UTF8Encoding($false)

[System.IO.File]::WriteAllText(
    $CtOutputPath,
    ($CtOutput | ConvertTo-Json -Depth 12),
    $CtUtf8
)

Write-Host "`nMO TA HINH ANH:" -ForegroundColor Green
Write-Host $CtDescription

Write-Host "`nTOKEN SU DUNG:"
$CtResponse.usageMetadata | Format-List

Write-Host "Da luu ket qua: $CtOutputPath"