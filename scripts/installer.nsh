; Sudowork Custom NSIS Script
; - Generates an install manifest at install time for selective uninstall
; - Replaces default "RMDir /r $INSTDIR" with manifest-based file removal
; - Preserves user-added files in the installation directory

!include "x64.nsh"

; ========================================
; Install: Record installed files into a manifest
; ========================================
!macro customInstall
  DetailPrint "Runtime components will be installed by Sudowork on first launch."

  ; Generate install manifest by scanning $INSTDIR after installation completes.
  ; This records every top-level file/directory so the uninstaller knows what to remove.
  ClearErrors
  FileOpen $0 "$INSTDIR\.install-manifest" w
  IfErrors _ci_skip_manifest

  FindFirst $1 $2 "$INSTDIR\*.*"
  _ci_loop:
    StrCmp $2 "" _ci_done
    StrCmp $2 "." _ci_next
    StrCmp $2 ".." _ci_next
    ; Skip the manifest file itself
    StrCmp $2 ".install-manifest" _ci_next
    FileWrite $0 "$2$\r$\n"
  _ci_next:
    FindNext $1 $2
    Goto _ci_loop
  _ci_done:
    FindClose $1
    FileClose $0

    ; Hide the manifest so users don't accidentally modify or delete it
    SetFileAttributes "$INSTDIR\.install-manifest" HIDDEN|SYSTEM
    DetailPrint "Install manifest created with list of installed files."
    Goto _ci_end

  _ci_skip_manifest:
    DetailPrint "Warning: Could not create install manifest file."

  _ci_end:
!macroend

; ========================================
; Auto-launch after installation
; ========================================
Function .onInstSuccess
  Exec '"$INSTDIR\Sudowork.exe"'
FunctionEnd

; ========================================
; Uninstall: Replace default "RMDir /r $INSTDIR" with manifest-based removal
; ========================================
; IMPORTANT: This macro REPLACES electron-builder's default file removal.
; electron-builder's NSIS template checks: if customRemoveFiles is defined,
; it calls this macro instead of "RMDir /r $INSTDIR".
!macro customRemoveFiles
  ; --- Step 1: Try to read the install manifest ---
  ClearErrors
  SetFileAttributes "$INSTDIR\.install-manifest" NORMAL
  FileOpen $0 "$INSTDIR\.install-manifest" r
  IfErrors _crf_no_manifest

  ; --- Step 2: Delete each entry listed in the manifest ---
  _crf_loop:
    ClearErrors
    FileRead $0 $1
    IfErrors _crf_loop_done

    ; Strip trailing newline characters (handle both CRLF and LF)
    StrCpy $3 $1 1 -1
    StrCmp $3 "$\n" 0 +2
      StrCpy $1 $1 -1
    StrCpy $3 $1 1 -1
    StrCmp $3 "$\r" 0 +2
      StrCpy $1 $1 -1

    ; Skip empty lines
    StrCmp $1 "" _crf_loop

    ; Build full path
    StrCpy $2 "$INSTDIR\$1"

    ; Check if path is a directory (contains sub-entries) or a file
    IfFileExists "$2\*.*" _crf_rmdir _crf_rmfile

  _crf_rmdir:
    RMDir /r "$2"
    IfErrors 0 _crf_loop
      DetailPrint "Warning: Could not fully remove directory: $1"
    Goto _crf_loop

  _crf_rmfile:
    Delete "$2"
    IfErrors 0 _crf_loop
      ; File may be locked - schedule removal on next reboot
      Delete /REBOOTOK "$2"
      DetailPrint "File locked, scheduled for removal on reboot: $1"
    Goto _crf_loop

  _crf_loop_done:
    FileClose $0

  ; --- Step 3: Remove the manifest file itself ---
  Delete "$INSTDIR\.install-manifest"

  ; --- Step 4: Clean up known runtime directories created after installation ---
  ; These directories are extracted/created on first app launch, not during install,
  ; so they won't appear in the manifest but should still be cleaned up.
  ; Add entries here as the app evolves:
  ;   RMDir /r "$INSTDIR\<runtime-dir>"

  ; --- Step 5: Try to remove $INSTDIR itself ---
  ; RMDir without /r only succeeds on an empty directory.
  ; If user files remain, this silently fails - which is the desired behavior.
  RMDir "$INSTDIR"

  Goto _crf_end

  ; --- Fallback: manifest missing or unreadable ---
  _crf_no_manifest:
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "安装清单未找到，无法精确卸载。$\r$\n$\r$\n\
      是否删除整个安装目录？$\r$\n\
      选择「否」将保留安装目录，您可以手动删除。" \
      IDYES _crf_fallback_delete IDNO _crf_end

  _crf_fallback_delete:
    RMDir /r "$INSTDIR"

  _crf_end:
!macroend
