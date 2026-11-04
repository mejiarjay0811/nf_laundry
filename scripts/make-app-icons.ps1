# Builds the icon and splash source images that @capacitor/assets and
# electron-builder expand into every size each platform wants.
#
# The shop's logo is a square with its own solid blue background, which decides
# the approach: the Android adaptive-icon background is filled with that same
# blue, sampled from the artwork itself, and the logo is placed on the
# foreground layer inside the safe zone. Because both blues are identical the
# join is invisible, and nothing has to be cut out of the artwork — a colour
# key would have punched holes through the blue lettering inside the white
# sticker shape.
#
# Usage:  powershell -File scripts/make-app-icons.ps1

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'public\logo.png'
$assets = Join-Path $root 'assets'
New-Item -ItemType Directory -Force -Path $assets | Out-Null

$logo = [System.Drawing.Image]::FromFile($source)
Write-Host ("source logo: {0}x{1}" -f $logo.Width, $logo.Height)

# The brand blue, taken from a corner so it is the background rather than any
# part of the artwork.
$probe = New-Object System.Drawing.Bitmap $logo
$brand = $probe.GetPixel(4, 4)
$probe.Dispose()
Write-Host ("brand colour: #{0:X2}{1:X2}{2:X2}" -f $brand.R, $brand.G, $brand.B)

function New-Canvas {
    param([int]$Size, [System.Drawing.Color]$Fill)
    $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
    $g = [System.Drawing.Graphics]::FromImage($bitmap)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    if ($Fill -ne [System.Drawing.Color]::Transparent) { $g.Clear($Fill) }
    return @{ Bitmap = $bitmap; Graphics = $g }
}

function Save-Canvas {
    param($Canvas, [string]$Path)
    $Canvas.Graphics.Dispose()
    $Canvas.Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $Canvas.Bitmap.Dispose()
    Write-Host ("wrote {0}" -f (Split-Path -Leaf $Path))
}

# --- icon.png: the logo edge to edge, used for legacy and round icons -------
$canvas = New-Canvas -Size 1024 -Fill $brand
$canvas.Graphics.DrawImage($logo, 0, 0, 1024, 1024)
Save-Canvas $canvas (Join-Path $assets 'icon.png')

# --- adaptive icon: solid background, logo inside the safe zone -------------
$canvas = New-Canvas -Size 1024 -Fill $brand
Save-Canvas $canvas (Join-Path $assets 'icon-background.png')

# Full bleed on purpose. @capacitor/assets insets this layer by 16.7% when it
# builds the adaptive icon, which is what creates the safe zone — adding a
# margin here as well would inset it twice and leave the mark small and lost
# in the middle of the tile.
$canvas = New-Canvas -Size 1024 -Fill ([System.Drawing.Color]::Transparent)
$canvas.Graphics.DrawImage($logo, 0, 0, 1024, 1024)
Save-Canvas $canvas (Join-Path $assets 'icon-foreground.png')

# --- splash screens ---------------------------------------------------------
foreach ($name in @('splash.png', 'splash-dark.png')) {
    $canvas = New-Canvas -Size 2732 -Fill $brand
    $mark = [int](2732 * 0.28)
    $at = [int]((2732 - $mark) / 2)
    $canvas.Graphics.DrawImage($logo, $at, $at, $mark, $mark)
    Save-Canvas $canvas (Join-Path $assets $name)
}

# --- Windows icon ----------------------------------------------------------
#
# A multi-size .ico rather than a single 256px image. Windows shows this at
# 16px in the taskbar and Explorer's small view, and its own runtime downscale
# of a detailed 256px logo is noticeably softer than one rendered at that size
# on purpose.
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$icoPath = Join-Path $root 'desktop\resources\icon.ico'
$images = @()

foreach ($size in $sizes) {
    $canvas = New-Canvas -Size $size -Fill ([System.Drawing.Color]::Transparent)
    $canvas.Graphics.DrawImage($logo, 0, 0, $size, $size)
    $canvas.Graphics.Dispose()
    $stream = New-Object System.IO.MemoryStream
    $canvas.Bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.Bitmap.Dispose()
    $images += , @{ Size = $size; Bytes = $stream.ToArray() }
    $stream.Dispose()
}

$ico = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter $ico
$writer.Write([UInt16]0)                 # reserved
$writer.Write([UInt16]1)                 # type: icon
$writer.Write([UInt16]$images.Count)

# Directory entries come first, so every image offset is known up front.
$offset = 6 + (16 * $images.Count)
foreach ($image in $images) {
    $dim = if ($image.Size -ge 256) { 0 } else { $image.Size }
    $writer.Write([Byte]$dim)            # width  (0 means 256)
    $writer.Write([Byte]$dim)            # height
    $writer.Write([Byte]0)               # palette size
    $writer.Write([Byte]0)               # reserved
    $writer.Write([UInt16]1)             # colour planes
    $writer.Write([UInt16]32)            # bits per pixel
    $writer.Write([UInt32]$image.Bytes.Length)
    $writer.Write([UInt32]$offset)
    $offset += $image.Bytes.Length
}
foreach ($image in $images) { $writer.Write($image.Bytes) }

$writer.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $ico.ToArray())
$writer.Dispose()
$ico.Dispose()
Write-Host ("wrote icon.ico ({0} sizes: {1})" -f $images.Count, ($sizes -join ', '))

$logo.Dispose()
Write-Host ''
Write-Host 'Next: npx @capacitor/assets generate --android'
