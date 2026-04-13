; Sudowork Custom NSIS Script
; - Generates an install manifest at install time for selective uninstall
; - Replaces default "RMDir /r $INSTDIR" with manifest-based file removal
; - Preserves user-added files in the installation directory
; - Overrides Simplified Chinese NSIS uninstall strings for standard terminology
; - Keeps Cancel button enabled during installation
; - Provides shortcut options page for desktop and start menu shortcuts
; - Modern visual styling with brand colours, custom fonts, and improved layout

!include "x64.nsh"
; MUI2.nsh and nsDialogs.nsh must be included here because electron-builder
; includes this file in the NSIS script header, BEFORE the main installer.nsi
; template loads MUI2.nsh. Macros (customHeader, customInstall, etc.) are
; unaffected because they are only defined at include time and expanded later.
; However, file-scope functions (tosPageCreate, etc.) are compiled immediately
; and need these headers available. All headers have include guards, so the
; later !include in installer.nsi is safely a no-op.
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; WS_BORDER is not defined in NSIS's standard WinMessages.nsh,
; so we define it here for use in custom dialog controls.
!ifndef WS_BORDER
  !define WS_BORDER 0x00800000
!endif

; ========================================
; Modern UI Visual Customisation
; ========================================
; Brand colour palette — dark navy / blue gradient with white text.
; These defines MUST appear before the first MUI page insertion so
; the MUI2 macros pick them up.

; Enable header image in the top-right corner of every step page
; Use !ifndef guards because electron-builder may already define these
; when installerHeader is set in electron-builder.yml.
!ifndef MUI_HEADERIMAGE
  !define MUI_HEADERIMAGE
!endif
!ifndef MUI_HEADERIMAGE_RIGHT
  !define MUI_HEADERIMAGE_RIGHT
!endif

; Background colour for the welcome / finish full-page panels
!define MUI_BGCOLOR "161C2D"

; Branded footer text shown in the bottom-left of every page
!define MUI_BRANDINGTEXT "Sudowork — 新一代企业 AI 应用平台"

; Colour of text on Welcome / Finish pages (white on dark background)
!define MUI_TEXTCOLOR "FFFFFF"

; Use the abort warning to confirm cancellation
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "确定要取消安装 Sudowork 吗？"

; ========================================
; Global variable declarations (file scope)
; ========================================
; IMPORTANT: These MUST be at file scope (outside any macro) so they are
; processed immediately when this file is !include'd. Declaring them inside
; a macro (e.g. customHeader) only creates them when the macro is expanded,
; which may be too late if assistedInstaller.nsh expands customPageAfterChangeDir
; first — causing "Pop $(user_var: output)" errors.
;
; Suppress warning 6001 ("Variable not referenced") for the uninstaller pass
; where these variables are declared but unused.
!pragma warning disable 6001

; Variable to store user's choice on whether to delete user data (~/.nexus/)
Var /GLOBAL deleteNexusData

; Variables for the Terms of Service / Privacy Policy agreement page
Var /GLOBAL tosPage.Dialog
Var /GLOBAL tosPage.Checkbox
Var /GLOBAL tosPage.TextBox

; Variables for the Shortcut Options page
Var /GLOBAL shortcutPage.Dialog
Var /GLOBAL shortcutPage.DesktopCheckbox
Var /GLOBAL shortcutPage.StartMenuCheckbox
Var /GLOBAL createDesktopShortcutChoice
Var /GLOBAL createStartMenuShortcutChoice

!pragma warning enable 6001

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
  LangString MUI_UNTEXT_WELCOME_INFO_TITLE ${LANG_SIMPCHINESE} "卸载 $(^NameDA)"
  LangString MUI_UNTEXT_WELCOME_INFO_TEXT ${LANG_SIMPCHINESE} \
    "此向导将引导你从计算机中移除 $(^NameDA)。$\r$\n$\r$\n\
    卸载将删除安装目录中的程序文件及相关数据。$\r$\n\
    卸载前，请确保 $(^NameDA) 已完全退出。$\r$\n$\r$\n$_CLICK"
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

  ; Override NSIS base language strings that still use "解除安装"
  ; These are separate from MUI2 strings and may show in window titles, buttons, and detail text.
  LangString ^UninstallCaption ${LANG_SIMPCHINESE} "$(^Name) 卸载"
  LangString ^UninstallBtn ${LANG_SIMPCHINESE} "卸载(&U)"
  LangString ^UnSubCaption_1 ${LANG_SIMPCHINESE} ": 正在卸载文件"
  LangString ^UninstalledText ${LANG_SIMPCHINESE} "$(^Name) 已成功从你的电脑中卸载。"
  LangString ^UninstallText ${LANG_SIMPCHINESE} "将从以下文件夹中卸载 $(^Name)。"
  !pragma warning enable 6030
!macroend

; ========================================
; Uninstaller welcome page: Hook into MUI2 GUI initialization
; ========================================
; The LangString overrides in customHeader may not take effect because NSIS
; uses the first definition (from MUI_LANGUAGE) and ignores subsequent ones.
; The SendMessage approach in un.onInit (customUnInit) also fails because
; MUI2 resets the window caption during GUI initialization, after un.onInit.
;
; Solution: Use customUnWelcomePage to register a page SHOW callback that runs
; AFTER the GUI is fully initialized, ensuring our caption override sticks.
!macro customUnWelcomePage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.overrideUninstCaption
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

; Callback function: Set uninstaller window title after GUI is ready.
; Guard with !ifdef BUILD_UNINSTALLER so this function is only compiled during
; the uninstaller pass. Otherwise NSIS warning 6010 (unreferenced function)
; is triggered during the installer pass and treated as a build error.
;
; Note: We use the numeric LCID 2052 instead of ${LANG_SIMPCHINESE} because
; this function is compiled at !include time, before MUI_LANGUAGE defines
; the LANG_SIMPCHINESE constant. LangString directives handle late-binding
; language IDs, but regular instructions like StrCmp require compile-time
; resolution — hence the raw value.
!ifdef BUILD_UNINSTALLER
Function un.overrideUninstCaption
  StrCmp $LANGUAGE 2052 0 +2
    SendMessage $HWNDPARENT 0x000C 0 "STR:${PRODUCT_NAME} 卸载"
FunctionEnd
!endif

; ========================================
; Keep Cancel button enabled on the INSTFILES page
; ========================================
; The customPageAfterChangeDir macro is expanded by assistedInstaller.nsh
; right before !insertmacro MUI_PAGE_INSTFILES, so any MUI_PAGE_CUSTOMFUNCTION_*
; defines set here will apply to the INSTFILES page.
;
; ========================================
; Custom pages and installer-only functions
; ========================================
; All installer-only Functions are defined INSIDE the customPageAfterChangeDir
; macro so they are compiled when the macro is expanded by assistedInstaller.nsh
; — which happens AFTER MUI2.nsh is loaded. This ensures MUI_HEADER_TEXT and
; other MUI2 macros are available.
;
; electron-builder prepends the custom script's !include BEFORE the main
; installer.nsi template (which loads MUI2.nsh). Functions defined at file
; scope would be compiled before MUI2 is loaded → "macro not found" error.
;
; A single macro is defined with !ifndef BUILD_UNINSTALLER inside the body.
; Variables are declared globally in customHeader (both passes) so that
; variable references are always valid. The !ifndef guard ensures the
; actual page logic only runs during the installer pass.
!macro customPageAfterChangeDir
!ifndef BUILD_UNINSTALLER

  ; ========================================
  ; Terms of Service / Privacy Policy Agreement Page
  ; ========================================
  ; Displays embedded ToS and Privacy content in a scrollable text area.
  ; The user must check the agreement checkbox before proceeding.

  Function tosPageCreate
    !insertmacro MUI_HEADER_TEXT "服务条款与隐私协议" "请阅读以下条款，勾选同意后继续安装"

    nsDialogs::Create 1018
    Pop $tosPage.Dialog
    ${If} $tosPage.Dialog == error
      Abort
    ${EndIf}

    ; --- Description label (larger, modern font) ---
    ${NSD_CreateLabel} 0 0 100% 18u "请仔细阅读以下服务条款和隐私协议："
    Pop $0
    CreateFont $1 "Microsoft YaHei UI" 10
    SendMessage $0 ${WM_SETFONT} $1 1

    ; --- Scrollable read-only text area with embedded ToS + Privacy content ---
    ; Use a taller text area for better readability
    nsDialogs::CreateControl "RichEdit20A" \
      ${WS_VISIBLE}|${WS_CHILD}|${WS_VSCROLL}|${WS_TABSTOP}|${WS_BORDER}|${ES_MULTILINE}|${ES_READONLY}|${ES_WANTRETURN} \
      ${WS_EX_STATICEDGE} \
      0 20u 100% 92u ""
    Pop $tosPage.TextBox
    ; Use the same modern font for text content
    CreateFont $3 "Microsoft YaHei UI" 9
    SendMessage $tosPage.TextBox ${WM_SETFONT} $3 1

    ; Set the embedded legal text content
    ${NSD_SetText} $tosPage.TextBox \
      "【服务条款】$\r$\n\
$\r$\n\
欢迎使用 Sudowork（以下简称「本软件」）。在安装和使用本软件前，请仔细阅读以下条款。安装或使用本软件即表示您同意接受以下条款的约束。$\r$\n\
$\r$\n\
一、服务内容$\r$\n\
本软件是由数牍隐私科技（以下简称「我们」）开发和运营的企业 AI 应用平台，为用户提供智能办公、数据处理等相关服务。我们有权根据业务需要对服务内容进行调整，并将通过适当方式通知用户。$\r$\n\
$\r$\n\
二、用户行为规范$\r$\n\
用户应合法、合规地使用本软件，不得利用本软件从事任何违反法律法规、侵害他人合法权益的行为。用户对其使用本软件的行为承担全部责任。$\r$\n\
$\r$\n\
三、知识产权$\r$\n\
本软件的所有知识产权（包括但不限于著作权、商标权、专利权）均归我们所有。未经我们书面许可，用户不得对本软件进行反编译、反汇编、逆向工程等操作。$\r$\n\
$\r$\n\
四、免责声明$\r$\n\
本软件按「现状」提供，我们不对软件的适用性、可靠性、准确性作任何明示或暗示的保证。因使用本软件产生的任何直接或间接损失，我们在法律允许的范围内不承担责任。$\r$\n\
$\r$\n\
五、条款变更$\r$\n\
我们保留随时修改本条款的权利。修改后的条款将通过软件更新或官方网站公布，继续使用本软件即视为接受修改后的条款。$\r$\n\
$\r$\n\
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$\r$\n\
$\r$\n\
【隐私协议】$\r$\n\
$\r$\n\
我们重视您的隐私保护。本隐私协议说明我们如何处理您的个人信息。$\r$\n\
$\r$\n\
一、信息收集$\r$\n\
本软件不会收集任何个人数据。您的所有数据（包括配置文件、聊天记录、业务数据等）均存储在本地设备上，我们不会获取、上传或访问这些内容。$\r$\n\
$\r$\n\
二、数据存储$\r$\n\
您使用本软件过程中产生的所有数据均保存在本地设备中。我们不会将您的数据传输至任何服务器，也不会在云端存储您的任何信息。$\r$\n\
$\r$\n\
三、无第三方共享$\r$\n\
由于本软件不收集任何数据，因此不存在向第三方共享个人信息的情况。$\r$\n\
$\r$\n\
四、本地数据管理$\r$\n\
您的数据完全由您自行管理。如需删除本地数据，可在卸载时选择删除用户数据，或手动删除安装目录下的相关文件。$\r$\n\
$\r$\n\
五、协议更新$\r$\n\
我们可能适时更新本隐私协议。更新后的协议将通过软件通知或官方网站公布。$\r$\n\
"

    ; --- Agreement checkbox (prominent, modern font) ---
    ${NSD_CreateCheckbox} 0 116u 100% 14u "我已阅读并同意上述服务条款和隐私协议"
    Pop $tosPage.Checkbox
    CreateFont $2 "Microsoft YaHei UI" 9 700
    SendMessage $tosPage.Checkbox ${WM_SETFONT} $2 1
    ${NSD_OnClick} $tosPage.Checkbox tosPageCheckboxClick

    ; Disable the "Next" button until the checkbox is checked
    GetDlgItem $0 $HWNDPARENT 1
    EnableWindow $0 0

    nsDialogs::Show
  FunctionEnd

  Function tosPageCheckboxClick
    ; Toggle Next button based on checkbox state
    ${NSD_GetState} $tosPage.Checkbox $0
    GetDlgItem $1 $HWNDPARENT 1
    ${If} $0 == ${BST_CHECKED}
      EnableWindow $1 1
    ${Else}
      EnableWindow $1 0
    ${EndIf}
  FunctionEnd

  Function tosPageLeave
    ; Final validation: ensure checkbox is checked before allowing navigation
    ${NSD_GetState} $tosPage.Checkbox $0
    ${If} $0 != ${BST_CHECKED}
      MessageBox MB_OK|MB_ICONEXCLAMATION "请先勾选「我已阅读并同意上述服务条款和隐私协议」后再继续。"
      Abort
    ${EndIf}
  FunctionEnd

  ; ========================================
  ; Shortcut Options Page
  ; ========================================
  ; Allows the user to choose whether to create desktop and start menu shortcuts.
  ; Both checkboxes are checked by default.

  Function shortcutPageCreate
    !insertmacro MUI_HEADER_TEXT "快捷方式设置" "选择要创建的快捷方式"

    nsDialogs::Create 1018
    Pop $shortcutPage.Dialog
    ${If} $shortcutPage.Dialog == error
      Abort
    ${EndIf}

    ; --- Description label (modern font, slightly larger) ---
    ${NSD_CreateLabel} 0 0 100% 20u "请选择安装过程中需要创建的快捷方式："
    Pop $0
    CreateFont $1 "Microsoft YaHei UI" 10
    SendMessage $0 ${WM_SETFONT} $1 1

    ; --- GroupBox for visual grouping ---
    ${NSD_CreateGroupBox} 0 24u 100% 58u "快捷方式选项"
    Pop $0
    CreateFont $4 "Microsoft YaHei UI" 9
    SendMessage $0 ${WM_SETFONT} $4 1

    ; --- Desktop shortcut checkbox (checked by default) ---
    ${NSD_CreateCheckbox} 14u 40u 90% 14u "创建桌面快捷方式(&D)"
    Pop $shortcutPage.DesktopCheckbox
    CreateFont $2 "Microsoft YaHei UI" 9
    SendMessage $shortcutPage.DesktopCheckbox ${WM_SETFONT} $2 1
    ${NSD_Check} $shortcutPage.DesktopCheckbox

    ; --- Start menu shortcut checkbox (checked by default) ---
    ${NSD_CreateCheckbox} 14u 60u 90% 14u "创建开始菜单快捷方式(&S)"
    Pop $shortcutPage.StartMenuCheckbox
    SendMessage $shortcutPage.StartMenuCheckbox ${WM_SETFONT} $2 1
    ${NSD_Check} $shortcutPage.StartMenuCheckbox

    nsDialogs::Show
  FunctionEnd

  Function shortcutPageLeave
    ; Store user's choices for later use in customInstall
    ${NSD_GetState} $shortcutPage.DesktopCheckbox $createDesktopShortcutChoice
    ${NSD_GetState} $shortcutPage.StartMenuCheckbox $createStartMenuShortcutChoice
  FunctionEnd

  Function instFilesShow
    ; Enable the Cancel button (NSIS button ID 2) so users can abort during installation
    GetDlgItem $0 $hwndParent 2
    EnableWindow $0 1
  FunctionEnd

  ; Insert the Terms of Service / Privacy Policy agreement page
  Page custom tosPageCreate tosPageLeave

  ; Insert the Shortcut Options page (desktop shortcut + start menu shortcut)
  Page custom shortcutPageCreate shortcutPageLeave

  ; Keep Cancel button enabled during installation
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW instFilesShow

!endif ; BUILD_UNINSTALLER
!macroend

; ========================================
; Custom Finish Page: Fix "Run Sudowork" checkbox color on dark background
; ========================================
; The MUI2 finish page uses MUI_BGCOLOR ("161C2D") as background and
; MUI_TEXTCOLOR ("FFFFFF") for labels, but the "Run" checkbox inherits the
; default system text colour (black / dark), making it nearly invisible.
; We define a customFinishPage macro so electron-builder uses our version
; instead of the default one, allowing us to attach a SHOW callback that
; forces the checkbox text to white.
!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function StartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif

  !define MUI_PAGE_CUSTOMFUNCTION_SHOW finishPageShow
  !insertmacro MUI_PAGE_FINISH

  Function finishPageShow
    ; Make the "Run" checkbox readable on the dark finish page background.
    ;
    ; On Windows 10/11 with visual styles enabled, checkbox controls are
    ; drawn by the theme engine (uxtheme.dll), which ignores the text/bg
    ; colours set via SetCtlColors (WM_CTLCOLORSTATIC).  Calling
    ; SetWindowTheme(hwnd, L" ", L" ") disables the visual style for this
    ; specific control, falling back to classic rendering that honours
    ; SetCtlColors.
    ${If} $mui.FinishPage.Run != 0
      System::Call 'uxtheme::SetWindowTheme(p $mui.FinishPage.Run, w " ", w " ")'
      SetCtlColors $mui.FinishPage.Run "FFFFFF" "161C2D"
    ${EndIf}
  FunctionEnd
!macroend

; ========================================
; Install: Record installed files into a manifest
; ========================================
!macro customInstall
  DetailPrint "Runtime components will be installed by Sudowork on first launch."

  ; --- Remove shortcuts if user opted out ---
  ; electron-builder creates shortcuts by default (createDesktopShortcut: true,
  ; createStartMenuShortcut: true in electron-builder.yml). We remove them here
  ; if the user unchecked the corresponding option on the Shortcut Options page.
  ${If} $createDesktopShortcutChoice != ${BST_CHECKED}
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    DetailPrint "Skipped desktop shortcut per user preference."
  ${EndIf}

  ${If} $createStartMenuShortcutChoice != ${BST_CHECKED}
    !ifdef MENU_FILENAME
      Delete "$SMPROGRAMS\${MENU_FILENAME}\${SHORTCUT_NAME}.lnk"
      RMDir "$SMPROGRAMS\${MENU_FILENAME}"
    !else
      Delete "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"
    !endif
    DetailPrint "Skipped start menu shortcut per user preference."
  ${EndIf}

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
; Uninstall: Prompt user about deleting user data before removal begins
; ========================================
; This macro runs BEFORE customRemoveFiles in the uninstall section.
; It asks the user whether to also delete user data (~/.nexus/) and stores
; the choice in $deleteNexusData for later use.
!macro customUnInstall
  StrCpy $deleteNexusData "0"
  ${IfNot} ${Silent}
    ${IfNot} ${isUpdated}
      MessageBox MB_YESNO|MB_ICONQUESTION \
        "是否同时删除用户数据（配置文件等）？$\r$\n$\r$\n\
        选择「是」将删除 $PROFILE\.nexus 目录中的所有用户配置和数据。$\r$\n\
        选择「否」将保留用户数据，仅卸载程序文件。" \
        IDYES _cuu_yes IDNO _cuu_end
      _cuu_yes:
        StrCpy $deleteNexusData "1"
      _cuu_end:
    ${EndIf}
  ${EndIf}
!macroend

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

  ; --- Delete user data (~/.nexus/) if user opted in ---
  StrCmp $deleteNexusData "1" 0 _crf_skip_nexus
    RMDir /r "$PROFILE\.nexus"
    DetailPrint "User data directory removed: $PROFILE\.nexus"
  _crf_skip_nexus:
!macroend
