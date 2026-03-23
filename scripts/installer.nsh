; Sudowork Custom NSIS Script
; Installs runtime components (Node.js, Sudoclaw, Nexus) after main installation

!macro customInstall
  ; Run PowerShell script to install runtime components
  ; Use ASCII output encoding for proper log display
  DetailPrint "Installing runtime components..."

  ; Get architecture
  StrCpy $0 "x64"
  ${If} ${RunningX64}
    StrCpy $0 "x64"
  ${Else}
    StrCpy $0 "ia32"
  ${EndIf}

  ; Run the install script
  ExecWait `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\install-runtime-components.ps1" -Arch "$0"` $1

  ${If} $1 == 0
    DetailPrint "Runtime components installed successfully"
  ${Else}
    DetailPrint "Warning: Some runtime components may not have installed correctly"
  ${EndIf}
!macroend