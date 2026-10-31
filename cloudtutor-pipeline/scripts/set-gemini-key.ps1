# Xóa key cũ để tránh dùng lại nếu nhập mới thất bại.
Remove-Variable CtGeminiApiKey, CtGeminiHeaders `
    -ErrorAction SilentlyContinue

$CtGeminiSecureKey = Read-Host "Dan Gemini API key" -AsSecureString

$CtGeminiCredential = New-Object System.Management.Automation.PSCredential(
    "gemini",
    $CtGeminiSecureKey
)

$CtGeminiCandidate = $CtGeminiCredential.GetNetworkCredential().Password.Trim()

Remove-Variable CtGeminiSecureKey, CtGeminiCredential

if ([string]::IsNullOrWhiteSpace($CtGeminiCandidate)) {
    Remove-Variable CtGeminiCandidate
    throw "Key rong. Hay copy lai API key tu Google AI Studio."
}

# Không chấp nhận khoảng trắng, ký tự điều khiển hoặc ký tự ngoài ASCII.
if ($CtGeminiCandidate -match '[^\x21-\x7E]') {
    Remove-Variable CtGeminiCandidate
    throw "Key chua ky tu khong hop le. Hay copy lai key va nhap lai."
}

$CtGeminiApiKey = $CtGeminiCandidate

$CtGeminiHeaders = @{
    "x-goog-api-key" = $CtGeminiApiKey
}

Remove-Variable CtGeminiCandidate

Write-Host "Da nap key; khong phat hien ky tu dieu khien." `
    -ForegroundColor Green