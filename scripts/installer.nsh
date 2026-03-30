; Sudowork Custom NSIS Script
; Installs runtime components (Node.js, bdpan) during setup
; Note: Nexus and Sudoclaw are installed at application startup with version detection

!include "x64.nsh"

; ========================================
; Custom Installation - Runtime Components
; ========================================
!macro customInstall
  ; Get user's home directory
  ReadEnvStr $R0 "USERPROFILE"
  StrCpy $R1 "$R0\.nexus"

  ; Create base directory structure for Node.js
  CreateDirectory "$R1"
  CreateDirectory "$R1\node"

  ; Show installation progress header
  DetailPrint "=========================================="
  DetailPrint "Installing Runtime Components"
  DetailPrint "Target: $R1"
  DetailPrint "=========================================="
  DetailPrint "Note: Nexus and Sudoclaw will be installed at first launch"
  DetailPrint "with version detection and incremental upgrade support."
  DetailPrint "=========================================="

  ; ========== [1/2] Node.js Runtime ==========
  DetailPrint "[1/2] Extracting Node.js runtime..."
  nsExec::ExecToStack 'powershell -NoProfile -Command "Expand-Archive -Path \"$INSTDIR\resources\node-win32-x64.zip\" -DestinationPath \"$R1\node\" -Force"'
  Pop $R2
  Pop $R3
  StrCmp $R2 "0" node_ok node_fail
  node_fail:
    DetailPrint "ERROR: Node.js extraction failed (exit code: $R2)"
    MessageBox MB_OK "Node.js extraction failed. The application may not work correctly."
    Goto node_done
  node_ok:
    DetailPrint "Node.js extracted successfully"
  node_done:

  ; ========== [2/2] bdpan CLI ==========
  DetailPrint "[2/2] Installing bdpan CLI..."
  IfFileExists "$INSTDIR\resources\bdpan-installer-windows-x64.exe" bdpan_run bdpan_skip
  bdpan_run:
    nsExec::ExecToStack '"$INSTDIR\resources\bdpan-installer-windows-x64.exe" --yes'
    Pop $R2
    Pop $R3
    StrCmp $R2 "0" bdpan_ok bdpan_warn
    bdpan_warn:
      DetailPrint "WARNING: bdpan installation returned exit code $R2 (non-fatal)"
      Goto bdpan_done
    bdpan_ok:
      DetailPrint "bdpan CLI installed successfully"
    bdpan_done:
    Goto bdpan_end
  bdpan_skip:
    DetailPrint "bdpan installer not found, skipping"
  bdpan_end:

  DetailPrint "=========================================="
  DetailPrint "Runtime components installation complete!"
  DetailPrint "=========================================="
!macroend

; ========================================
; Auto-launch after installation
; ========================================
Function .onInstSuccess
  Exec '"$INSTDIR\Sudowork.exe"'
FunctionEnd
