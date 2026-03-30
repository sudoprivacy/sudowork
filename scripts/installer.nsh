; Sudowork Custom NSIS Script
; Installs runtime components (Node.js, Sudoclaw, Nexus) during setup

!include "x64.nsh"
!include "LogicLib.nsh"

; ========================================
; Custom Installation - Runtime Components
; ========================================
!macro customInstall
  ; Get user's home directory
  ReadEnvStr $R0 "USERPROFILE"
  StrCpy $R1 "$R0\.nexus"

  ; Detect Architecture
  StrCpy $R4 "x64"
  ${If} ${IsNativeARM64}
    StrCpy $R4 "arm64"
  ${EndIf}

  ; Create directory structure
  CreateDirectory "$R1"
  CreateDirectory "$R1\node"
  CreateDirectory "$R1\sudoclaw\cli"
  CreateDirectory "$R1\sudoclaw\bin"
  CreateDirectory "$R1\nexus_env"

  ; Show installation progress header
  DetailPrint "=========================================="
  DetailPrint "Installing Runtime Components ($R4)"
  DetailPrint "Target: $R1"
  DetailPrint "=========================================="

  ; ========== [1/4] Node.js Runtime ==========
  DetailPrint "[1/4] Extracting Node.js runtime with 7-Zip..."
  nsExec::ExecToStack '"$INSTDIR\resources\7za.exe" x "$INSTDIR\resources\node-win32-$R4.zip" -y -o"$R1\node"'
  Pop $R2 ; Exit Code
  Pop $R3 ; Output
  StrCmp $R2 "0" node_ok node_fail
  node_fail:
    DetailPrint "ERROR: Node.js extraction failed (exit code: $R2)"
    DetailPrint "Output: $R3"
    MessageBox MB_OK "Node.js extraction failed. $\n$\nError: $R3"
    Goto node_done
  node_ok:
    DetailPrint "Node.js extracted successfully"
  node_done:

  ; ========== [2/4] Sudoclaw (OpenClaw) ==========
  ; tgz contains: package/... with package/bin/openclaw.cmd inside
  ; Extract to cli directory, then move bin to parent
  DetailPrint "[2/4] Extracting Sudoclaw with 7-Zip..."
  ; Two-step extraction for TGZ to avoid PowerShell pipe hangs
  nsExec::ExecToStack '"$INSTDIR\resources\7za.exe" x "$INSTDIR\resources\openclaw.tgz" -y -o"$R1\sudoclaw\cli"'
  nsExec::ExecToStack '"$INSTDIR\resources\7za.exe" x "$R1\sudoclaw\cli\openclaw.tar" -y -o"$R1\sudoclaw\cli"'
  Pop $R2 ; Exit Code
  Pop $R3 ; Output
  Delete "$R1\sudoclaw\cli\openclaw.tar"
  StrCmp $R2 "0" sudoclaw_ok sudoclaw_fail
  sudoclaw_fail:
    DetailPrint "ERROR: Sudoclaw extraction failed (exit code: $R2)"
    DetailPrint "Output: $R3"
    MessageBox MB_OK "Sudoclaw extraction failed. $\n$\nError: $R3"
    Goto sudoclaw_done
  sudoclaw_ok:
    DetailPrint "Sudoclaw extracted successfully"
    ; Move bin from package/bin to ~/.nexus/sudoclaw/bin
    IfFileExists "$R1\sudoclaw\cli\package\bin\openclaw.cmd" 0 sudoclaw_done
    DetailPrint "Setting up Sudoclaw CLI wrappers..."
    ; Use NSIS native CopyFiles for simplicity and no dependency
    CopyFiles /SILENT "$R1\sudoclaw\cli\package\bin\*" "$R1\sudoclaw\bin"
  sudoclaw_done:

  ; ========== [3/4] Nexus ==========
  DetailPrint "[3/4] Extracting Nexus with 7-Zip..."
  ; Two-step extraction for TGZ/TAR.GZ to avoid PowerShell pipe hangs
  nsExec::ExecToStack '"$INSTDIR\resources\7za.exe" x "$INSTDIR\resources\nexus.tar.gz" -y -o"$R1\nexus_env"'
  nsExec::ExecToStack '"$INSTDIR\resources\7za.exe" x "$R1\nexus_env\nexus.tar" -y -o"$R1\nexus_env"'
  Pop $R2 ; Exit Code
  Pop $R3 ; Output
  Delete "$R1\nexus_env\nexus.tar"
  StrCmp $R2 "0" nexus_ok nexus_fail
  nexus_fail:
    DetailPrint "WARNING: Nexus extraction failed (exit code: $R2)"
    DetailPrint "Output: $R3"
    Goto nexus_done
  nexus_ok:
    DetailPrint "Nexus extracted successfully"

    ; Run conda-unpack to fix hardcoded install paths baked into the conda environment.
    ; On Windows, conda places scripts in Scripts\ (not bin\ like macOS/Linux).
    DetailPrint "Running conda-unpack to fix install paths..."
    IfFileExists "$R1\nexus_env\Scripts\conda-unpack.exe" condaunpack_run condaunpack_skip
    condaunpack_run:
      nsExec::ExecToStack '"$R1\nexus_env\Scripts\conda-unpack.exe"'
      Pop $R2 ; Exit Code
      Pop $R3 ; Output
      StrCmp $R2 "0" condaunpack_ok condaunpack_warn
      condaunpack_warn:
        DetailPrint "WARNING: conda-unpack returned exit code $R2 (non-fatal)"
        DetailPrint "Output: $R3"
        Goto condaunpack_done
      condaunpack_ok:
        DetailPrint "conda-unpack completed successfully"
      condaunpack_done:
      Goto nexus_done
    condaunpack_skip:
      DetailPrint "conda-unpack.exe not found at Scripts\conda-unpack.exe — skipping"
  nexus_done:

  ; ========== [4/4] bdpan CLI ==========
  DetailPrint "[4/4] Installing bdpan CLI..."
  IfFileExists "$INSTDIR\resources\bdpan-installer-windows-x64.exe" bdpan_run bdpan_skip
  bdpan_run:
    nsExec::ExecToStack '"$INSTDIR\resources\bdpan-installer-windows-x64.exe" --yes'
    Pop $R2 ; Exit Code
    Pop $R3 ; Output
    StrCmp $R2 "0" bdpan_ok bdpan_warn
    bdpan_warn:
      DetailPrint "WARNING: bdpan installation returned exit code $R2 (non-fatal)"
      DetailPrint "Output: $R3"
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
