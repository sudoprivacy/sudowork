; Sudowork Custom NSIS Script
; Runtime components are installed by the app on first launch / startup.

!include "x64.nsh"

!macro customInstall
  DetailPrint "Runtime components will be installed by Sudowork on first launch."
!macroend

; ========================================
; Auto-launch after installation
; ========================================
Function .onInstSuccess
  Exec '"$INSTDIR\Sudowork.exe"'
FunctionEnd
