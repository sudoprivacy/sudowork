declare module '@electron/remote' {
  export interface OpenDialogOptions {
    title?: string;
    defaultPath?: string;
    buttonLabel?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles' | 'createDirectory' | 'promptToCreate' | 'noResolveAliases' | 'treatPackageAsDirectory' | 'dontAddToRecent'>;
    message?: string;
    securityScopedBookmarks?: boolean;
  }

  export interface OpenDialogReturnValue {
    canceled: boolean;
    filePaths: string[];
    bookmarks?: string[];
  }

  export interface Dialog {
    showOpenDialog(browserWindow: any, options: OpenDialogOptions): Promise<OpenDialogReturnValue>;
    showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogReturnValue>;
  }

  export const dialog: Dialog;
}
