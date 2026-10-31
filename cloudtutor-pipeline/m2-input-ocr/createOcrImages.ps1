param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$CtCases = Get-Content (Join-Path $PSScriptRoot "ocr-cases.json") -Raw -Encoding UTF8 | ConvertFrom-Json
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
foreach ($CtCase in $CtCases) {
    $CtBitmap = New-Object System.Drawing.Bitmap(1400, 360)
    $CtGraphics = [System.Drawing.Graphics]::FromImage($CtBitmap)
    $CtFont = New-Object System.Drawing.Font("Arial", [single]$CtCase.font_size, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $CtGray = [int]$CtCase.gray
    $CtBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($CtGray, $CtGray, $CtGray))
    try {
        $CtGraphics.Clear([System.Drawing.Color]::White)
        $CtGraphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $CtY = 55
        foreach ($CtLine in @($CtCase.lines)) {
            $CtGraphics.DrawString([string]$CtLine, $CtFont, $CtBrush, [single]45, [single]$CtY)
            $CtY += 85
        }
        $CtBitmap.Save((Join-Path $Destination $CtCase.image), [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally { $CtBrush.Dispose(); $CtFont.Dispose(); $CtGraphics.Dispose(); $CtBitmap.Dispose() }
}
$CtManifest = @($CtCases | ForEach-Object {
    @{ id = $_.id; language = $_.language; image = $_.image; reference = ($_.lines -join "`n"); font_size = $_.font_size; gray = $_.gray }
})
$CtUtf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $Destination "manifest.json"), (ConvertTo-Json -InputObject $CtManifest -Depth 8), $CtUtf8)
Write-Host "CREATED: 7 OCR probe images with known reference text."
