Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = "Stop"

function New-RoundedRectPath {
  param(
    [float] $X,
    [float] $Y,
    [float] $Width,
    [float] $Height,
    [float] $Radius
  )

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-LuduoIcon {
  param(
    [int] $Size,
    [string] $OutputPath
  )

  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml("#090b10"))

  $card = New-RoundedRectPath ($Size * 0.16) ($Size * 0.15) ($Size * 0.68) ($Size * 0.70) ($Size * 0.15)
  $startPoint = New-Object System.Drawing.PointF -ArgumentList ([float]($Size * 0.16)), ([float]($Size * 0.15))
  $endPoint = New-Object System.Drawing.PointF -ArgumentList ([float]($Size * 0.84)), ([float]($Size * 0.85))
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList @(
    $startPoint,
    $endPoint,
    [System.Drawing.ColorTranslator]::FromHtml("#24d6ff"),
    [System.Drawing.ColorTranslator]::FromHtml("#ff4f91")
  )
  $blend = New-Object System.Drawing.Drawing2D.ColorBlend
  $blend.Positions = @(0.0, 0.52, 1.0)
  $blend.Colors = @(
    [System.Drawing.ColorTranslator]::FromHtml("#24d6ff"),
    [System.Drawing.ColorTranslator]::FromHtml("#6ef3a5"),
    [System.Drawing.ColorTranslator]::FromHtml("#ff4f91")
  )
  $brush.InterpolationColors = $blend
  $graphics.FillPath($brush, $card)

  $darkBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#071015"))
  $leftPaddle = New-RoundedRectPath ($Size * 0.26) ($Size * 0.28) ($Size * 0.095) ($Size * 0.44) ($Size * 0.047)
  $rightPaddle = New-RoundedRectPath ($Size * 0.645) ($Size * 0.28) ($Size * 0.095) ($Size * 0.44) ($Size * 0.047)
  $graphics.FillPath($darkBrush, $leftPaddle)
  $graphics.FillPath($darkBrush, $rightPaddle)

  $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#f6f8ff"))
  $graphics.FillEllipse($whiteBrush, $Size * 0.435, $Size * 0.435, $Size * 0.13, $Size * 0.13)

  $linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(180, 246, 248, 255), [Math]::Max(4, $Size * 0.035))
  $linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $linePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLine($linePen, $Size * 0.43, $Size * 0.18, $Size * 0.57, $Size * 0.18)
  $graphics.DrawLine($linePen, $Size * 0.43, $Size * 0.82, $Size * 0.57, $Size * 0.82)

  $directory = Split-Path -Parent $OutputPath
  if (-not (Test-Path $directory)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
  }

  $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)

  $linePen.Dispose()
  $whiteBrush.Dispose()
  $darkBrush.Dispose()
  $brush.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

$assets = Join-Path $PSScriptRoot "..\public\assets"
New-LuduoIcon 192 (Join-Path $assets "icon-192.png")
New-LuduoIcon 512 (Join-Path $assets "icon-512.png")
