; Sudowork Custom NSIS Script
; - Generates an install manifest at install time for selective uninstall
; - Replaces default "RMDir /r $INSTDIR" with manifest-based file removal
; - Preserves user-added files in the installation directory
; - Overrides Simplified Chinese NSIS uninstall strings for standard terminology
; - Keeps Cancel button enabled during installation
; - Adds desktop & start menu shortcut options

!include "x64.nsh"
!include "nsDialogs.nsh"

; ========================================
; Language overrides: Standardize Simplified Chinese uninstall terminology
; NSIS built-in SimpChinese strings may use "解除安装" (Traditional Chinese style).
; We override them to use "卸载" which is the standard Simplified Chinese term.
; ========================================
!macro customHeader
  ; Override MUI2 uninstaller page strings for Simplified Chinese (LANG_SIMPCHINESE)
  ; Suppress warning 6030 (LangString set multiple times) since we intentionally
  ; override the strings already defined by MUI_LANGUAGE "SimpChinese".
  !pragma warning disable 6030
  LangString MUI_UNTEXT_WELCOME_INFO_TITLE ${LANG_SIMPCHINESE} "欢迎使用 $(^NameDA) 卸载向导"
  LangString MUI_UNTEXT_WELCOME_INFO_TEXT ${LANG_SIMPCHINESE} \
    "此向导将引导你卸载 $(^NameDA)。$\r$\n$\r$\n\
    卸载前，请确保 $(^NameDA) 已经关闭。$\r$\n$\r$\n$_CLICK"
  LangString MUI_UNTEXT_CONFIRM_TITLE ${LANG_SIMPCHINESE} "卸载 $(^NameDA)"
  LangString MUI_UNTEXT_CONFIRM_SUBTITLE ${LANG_SIMPCHINESE} "从你的电脑中卸载 $(^NameDA)。"
  LangString MUI_UNTEXT_UNINSTALLING_TITLE ${LANG_SIMPCHINESE} "正在卸载"
  LangString MUI_UNTEXT_UNINSTALLING_SUBTITLE ${LANG_SIMPCHINESE} "$(^NameDA) 正在卸载，请稍候。"
  LangString MUI_UNTEXT_FINISH_TITLE ${LANG_SIMPCHINESE} "卸载完成"
  LangString MUI_UNTEXT_FINISH_SUBTITLE ${LANG_SIMPCHINESE} "卸载已成功完成。"
  LangString MUI_UNTEXT_FINISH_INFO_TITLE ${LANG_SIMPCHINESE} "正在完成 $(^NameDA) 卸载向导"
  LangString MUI_UNTEXT_FINISH_INFO_TEXT ${LANG_SIMPCHINESE} \
    "$(^NameDA) 已从你的电脑中卸载。$\r$\n$\r$\n\
    点击「完成」关闭此向导。"
  LangString MUI_UNTEXT_FINISH_INFO_REBOOT ${LANG_SIMPCHINESE} \
    "要完成 $(^NameDA) 的卸载，必须重新启动你的电脑。你想现在重新启动吗？"
  LangString MUI_UNTEXT_ABORT_TITLE ${LANG_SIMPCHINESE} "卸载已中止"
  LangString MUI_UNTEXT_ABORT_SUBTITLE ${LANG_SIMPCHINESE} "卸载未能完成。"
  !pragma warning enable 6030
!macroend

; ========================================
; Uninstaller init: Override window caption for Simplified Chinese
; ========================================
!macro customUnInit
  ; Override uninstaller window title for Simplified Chinese
  ; The NSIS base ^UninstallCaption string may use "解除安装"
  ; Note: Caption is a top-level command and cannot be used inside Functions.
  ; We use SendMessage with WM_SETTEXT (0x000C) to set the window title at runtime.
  StrCmp $LANGUAGE ${LANG_SIMPCHINESE} 0 +2
    SendMessage $HWNDPARENT 0x000C 0 "STR:${PRODUCT_NAME} 卸载"
!macroend

; ========================================
; Custom page: Shortcut options (Desktop & Start Menu)
; Keep Cancel button enabled on the INSTFILES page
; ========================================
; Guard with !ifndef BUILD_UNINSTALLER because electron-builder runs makensis
; twice: once for the uninstaller (BUILD_UNINSTALLER defined) and once for the
; installer.  During the uninstaller pass assistedInstaller.nsh skips the
; install-page section, so customPageAfterChangeDir is never expanded and the
; functions would be unreferenced → NSIS warning 6010 → build error.
!ifndef BUILD_UNINSTALLER

; Variables for shortcut option checkboxes
; Declared inside !ifndef BUILD_UNINSTALLER to avoid NSIS warning 6001
; ("variable not referenced") during the uninstaller build pass.
Var /GLOBAL desktopShortcutCheckbox
Var /GLOBAL startMenuShortcutCheckbox
Var /GLOBAL createDesktopShortcut
Var /GLOBAL createStartMenuShortcut

!macro customPageAfterChangeDir
  Page custom shortcutOptionsPageCreate shortcutOptionsPageLeave
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW instFilesShow
!macroend

Function shortcutOptionsPageCreate
  ; Skip this page on silent/update installs.
  ; When electron-builder performs an auto-update, it invokes the installer
  ; with the /S (silent) flag, so IfSilent correctly detects update scenarios
  ; without requiring the StdUtils plugin.
  IfSilent 0 +2
    Abort

  !insertmacro MUI_HEADER_TEXT "选择附加任务" "选择安装过程中要执行的附加任务。"

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 20u "选择要执行的附加任务："
  Pop $0

  ${NSD_CreateCheckbox} 20u 25u -20u 15u "创建桌面快捷方式(&D)"
  Pop $desktopShortcutCheckbox
  ${NSD_Check} $desktopShortcutCheckbox

  ${NSD_CreateCheckbox} 20u 45u -20u 15u "创建「开始」菜单快捷方式(&S)"
  Pop $startMenuShortcutCheckbox
  ${NSD_Check} $startMenuShortcutCheckbox

  nsDialogs::Show
FunctionEnd

Function shortcutOptionsPageLeave
  ${NSD_GetState} $desktopShortcutCheckbox $createDesktopShortcut
  ${NSD_GetState} $startMenuShortcutCheckbox $createStartMenuShortcut
FunctionEnd

Function instFilesShow
  ; Enable the Cancel button (NSIS button ID 2) so users can abort during installation
  GetDlgItem $0 $hwndParent 2
  EnableWindow $0 1
FunctionEnd
!endif

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

  ; --- Shortcut options: Remove shortcuts if user unchecked them ---
  ; The electron-builder install section creates shortcuts by default before
  ; this macro runs. We remove unwanted shortcuts based on user choices.
  ${If} $createDesktopShortcut != ${BST_CHECKED}
    Delete "$newDesktopLink"
    DetailPrint "Skipped desktop shortcut per user preference."
  ${EndIf}

  ${If} $createStartMenuShortcut != ${BST_CHECKED}
    Delete "$newStartMenuLink"
    !ifdef MENU_FILENAME
      RMDir "$SMPROGRAMS\${MENU_FILENAME}"
    !endif
    DetailPrint "Skipped Start Menu shortcut per user preference."
  ${EndIf}
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
