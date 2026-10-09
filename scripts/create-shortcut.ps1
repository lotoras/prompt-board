$repo = Split-Path $PSScriptRoot -Parent
$ws = New-Object -ComObject WScript.Shell
$lnkPath = Join-Path $ws.SpecialFolders.Item('Desktop') 'Prompt Board.lnk'
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath = "$env:WINDIR\System32\cmd.exe"
$lnk.Arguments = '/c "' + (Join-Path $repo 'scripts\launch.cmd') + '"'
$lnk.WorkingDirectory = $repo
$lnk.IconLocation = (Join-Path $repo 'build\icon.ico') + ',0'
$lnk.WindowStyle = 1
$lnk.Description = 'Build + launch Prompt Board'
$lnk.Save()
Write-Output "Created $lnkPath"
