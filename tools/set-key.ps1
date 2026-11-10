Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$f = New-Object Windows.Forms.Form
$f.Text = 'Groq API Key'
$f.Size = New-Object Drawing.Size(460, 170)
$f.StartPosition = 'CenterScreen'
$f.TopMost = $true
$f.FormBorderStyle = 'FixedDialog'

$l = New-Object Windows.Forms.Label
$l.Text = '貼上 Groq API Key（gsk_ 開頭），按確定：'
$l.Location = New-Object Drawing.Point(12, 12)
$l.AutoSize = $true
$f.Controls.Add($l)

$t = New-Object Windows.Forms.TextBox
$t.Location = New-Object Drawing.Point(12, 40)
$t.Width = 420
$t.UseSystemPasswordChar = $true
$f.Controls.Add($t)

$ok = New-Object Windows.Forms.Button
$ok.Text = '確定'
$ok.Location = New-Object Drawing.Point(276, 80)
$ok.DialogResult = 'OK'
$f.Controls.Add($ok)
$f.AcceptButton = $ok

$c = New-Object Windows.Forms.Button
$c.Text = '取消'
$c.Location = New-Object Drawing.Point(357, 80)
$c.DialogResult = 'Cancel'
$f.Controls.Add($c)
$f.CancelButton = $c

if ($f.ShowDialog() -eq 'OK' -and $t.Text.Trim()) {
  $k = $t.Text.Trim()
  [Environment]::SetEnvironmentVariable('GROQ_API_KEY', $k, 'User')
  $root = Split-Path -Parent $PSScriptRoot
  Set-Content -Path (Join-Path $root '.dev.vars') -Value "GROQ_API_KEY=$k" -Encoding UTF8
  $pre = $k.Substring(0, [Math]::Min(7, $k.Length))
  Write-Output "SAVED prefix=$pre len=$($k.Length)"
} else {
  Write-Output 'CANCELLED'
}
