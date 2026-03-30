; Sudowork Custom NSIS Script
; Installs runtime components (Git, Node.js, Sudoclaw, Nexus, bdpan) during setup

!include "x64.nsh"

; ========================================
; Custom Installation - Runtime Components
; ========================================
!macro customInstall
  ; Get user's home directory
  ReadEnvStr $R0 "USERPROFILE"
  StrCpy $R1 "$R0\.nexus"

  ; Create directory structure
  CreateDirectory "$R1"
  CreateDirectory "$R1\node"
  CreateDirectory "$R1\sudoclaw\cli"
  CreateDirectory "$R1\sudoclaw\bin"
  CreateDirectory "$R1\nexus_env"

  ; Show installation progress header
  DetailPrint "=========================================="
  DetailPrint "Installing Runtime Components"
  DetailPrint "Target: $R1"
  DetailPrint "=========================================="

  ; ========== [1/5] Git Check & Install ==========
  DetailPrint "[1/5] Checking Git installation..."
  nsExec::ExecToStack 'git --version'
  Pop $R2 ; exit code
  Pop $R3 ; output (git version string)
  StrCmp $R2 "0" git_already_ok git_need_install

  git_need_install:
    DetailPrint "Git not found. Downloading Git for Windows..."
    ; Determine Windows architecture from environment variable
    ReadEnvStr $R4 "PROCESSOR_ARCHITECTURE"
    StrCmp $R4 "ARM64" git_use_arm64 git_use_x64

    git_use_arm64:
      StrCpy $R5 "Git-2.47.1-arm64.exe"
      StrCpy $R6 "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/Git-2.47.1-arm64.exe"
      Goto git_download

    git_use_x64:
      StrCpy $R5 "Git-2.47.1-64-bit.exe"
      StrCpy $R6 "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/Git-2.47.1-64-bit.exe"

    git_download:
      DetailPrint "Downloading: $R6"
      nsExec::ExecToStack 'powershell -NoProfile -Command "Invoke-WebRequest -Uri \"$R6\" -OutFile \"$TEMP\$R5\" -UseBasicParsing"'
      Pop $R2
      Pop $R3
      StrCmp $R2 "0" git_run_installer git_download_failed

      git_download_failed:
        DetailPrint "WARNING: Git download failed (exit code: $R2)"
        DetailPrint "Please install Git manually: https://git-scm.com/download/win"
        Goto git_done

      git_run_installer:
        DetailPrint "Running Git installer silently..."
        nsExec::ExecToStack '"$TEMP\$R5" /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /COMPONENTS="icons,ext\reg\shellhere,assoc,assoc_sh"'
        Pop $R2
        Pop $R3
        StrCmp $R2 "0" git_installed_ok git_install_failed

        git_install_failed:
          DetailPrint "WARNING: Git installer returned exit code $R2 (may still succeed)"
          Goto git_done

        git_installed_ok:
          DetailPrint "Git for Windows installed successfully"
          Goto git_done

  git_already_ok:
    DetailPrint "Git already installed: $R3"

  git_done:

  ; ========== [2/5] Node.js Runtime ==========
  DetailPrint "[2/5] Extracting Node.js runtime..."
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

  ; ========== [3/5] Sudoclaw (OpenClaw) ==========
  ; tgz contains: package/... with package/bin/openclaw.cmd inside
  ; Extract to cli directory, then move bin to parent
  DetailPrint "[3/5] Extracting Sudoclaw..."
  nsExec::ExecToStack 'tar -xzf "$INSTDIR\resources\openclaw.tgz" -C "$R1\sudoclaw\cli" --overwrite'
  Pop $R2
  Pop $R3
  StrCmp $R2 "0" sudoclaw_ok sudoclaw_fail
  sudoclaw_fail:
    DetailPrint "ERROR: Sudoclaw extraction failed (exit code: $R2)"
    MessageBox MB_OK "Sudoclaw extraction failed. The application may not work correctly."
    Goto sudoclaw_done
  sudoclaw_ok:
    DetailPrint "Sudoclaw extracted successfully"
    IfFileExists "$INSTDIR\resources\openclaw.manifest.json" 0 +3
    DetailPrint "Writing Sudoclaw install manifest..."
    CopyFiles /SILENT "$INSTDIR\resources\openclaw.manifest.json" "$R1\sudoclaw\install-manifest.json"
    ; Move bin from package/bin to ~/.nexus/sudoclaw/bin
    IfFileExists "$R1\sudoclaw\cli\package\bin\openclaw.cmd" 0 sudoclaw_done
    DetailPrint "Setting up Sudoclaw CLI wrappers..."
    nsExec::ExecToStack 'powershell -NoProfile -Command "Copy-Item -Path \"$R1\sudoclaw\cli\package\bin\*\" -Destination \"$R1\sudoclaw\bin\" -Force"'
    Pop $R4
    Pop $R5
  sudoclaw_done:

  ; ========== [4/5] Nexus ==========
  DetailPrint "[4/5] Extracting Nexus..."
  nsExec::ExecToStack 'tar -xzf "$INSTDIR\resources\nexus.tar.gz" -C "$R1\nexus_env" --overwrite'
  Pop $R2
  Pop $R3
  StrCmp $R2 "0" nexus_ok nexus_fail
  nexus_fail:
    DetailPrint "WARNING: Nexus extraction failed (exit code: $R2)"
    DetailPrint "Some features may not work."
    Goto nexus_done
  nexus_ok:
    DetailPrint "Nexus extracted successfully"
    ; Run conda-unpack to fix hardcoded install paths baked into the conda environment.
    ; On Windows, conda places scripts in Scripts\ (not bin\ like macOS/Linux).
    DetailPrint "Running conda-unpack to fix install paths..."
    IfFileExists "$R1\nexus_env\Scripts\conda-unpack.exe" condaunpack_run condaunpack_skip
    condaunpack_run:
      nsExec::ExecToStack '"$R1\nexus_env\Scripts\conda-unpack.exe"'
      Pop $R2
      Pop $R3
      StrCmp $R2 "0" condaunpack_ok condaunpack_warn
      condaunpack_warn:
        DetailPrint "WARNING: conda-unpack returned exit code $R2 (non-fatal)"
        Goto condaunpack_done
      condaunpack_ok:
        DetailPrint "conda-unpack completed successfully"
      condaunpack_done:
      Goto nexus_done
    condaunpack_skip:
      DetailPrint "conda-unpack.exe not found at Scripts\conda-unpack.exe — skipping"
  nexus_done:

  ; ========== [5/5] bdpan CLI ==========
  DetailPrint "[5/5] Installing bdpan CLI..."
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
