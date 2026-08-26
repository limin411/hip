; hip NSIS Installer Hooks
; 自动安装/卸载内置编程字体（JetBrainsMono Nerd Font Mono）

!macro NSIS_HOOK_POSTINSTALL
  ; ── 安装字体到系统 ──
  ; 将 TTF 文件复制到 Windows Fonts 目录并注册到注册表
  ; 这样 Windows Terminal、VS Code 等外部终端也能使用该字体

  DetailPrint "Installing bundled fonts..."

  ; 复制字体文件到系统 Fonts 目录
  ; 注意：主安装脚本已将字体复制到 $INSTDIR\fonts\
  ; 这里用 CopyFiles 从应用目录复制到系统字体目录
  CopyFiles "$INSTDIR\fonts\JetBrainsMonoNerdFontMono-Regular.ttf" "$FONTS\JetBrainsMonoNerdFontMono-Regular.ttf"
  CopyFiles "$INSTDIR\fonts\JetBrainsMonoNerdFontMono-Bold.ttf" "$FONTS\JetBrainsMonoNerdFontMono-Bold.ttf"

  ; 注册字体到注册表（需要管理员权限写入 HKLM）
  WriteRegStr HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts" \
    "JetBrainsMono Nerd Font Mono (TrueType)" "JetBrainsMonoNerdFontMono-Regular.ttf"
  WriteRegStr HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts" \
    "JetBrainsMono Nerd Font Mono Bold (TrueType)" "JetBrainsMonoNerdFontMono-Bold.ttf"

  ; 通知系统刷新字体缓存
  SendMessage ${HWND_BROADCAST} ${WM_FONTCHANGE} 0 0 /TIMEOUT=1000

  DetailPrint "Fonts installed successfully."
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; ── 卸载时清理字体 ──
  ; 仅在用户确认卸载后执行

  DetailPrint "Removing bundled fonts..."

  ; 删除注册表条目
  DeleteRegValue HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts" \
    "JetBrainsMono Nerd Font Mono (TrueType)"
  DeleteRegValue HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts" \
    "JetBrainsMono Nerd Font Mono Bold (TrueType)"

  ; 删除字体文件（延迟删除，因为可能正被使用）
  ; 使用 /REBOOTOK 允许重启后完成删除
  Delete /REBOOTOK "$FONTS\JetBrainsMonoNerdFontMono-Regular.ttf"
  Delete /REBOOTOK "$FONTS\JetBrainsMonoNerdFontMono-Bold.ttf"

  ; 通知系统刷新字体缓存
  SendMessage ${HWND_BROADCAST} ${WM_FONTCHANGE} 0 0 /TIMEOUT=1000

  DetailPrint "Fonts removed."
!macroend
