import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const providers = new Map<string, (params: any) => unknown>();
  const makeProvider = (name: string) => ({
    provider: vi.fn((fn: (params: any) => unknown) => {
      providers.set(name, fn);
    }),
  });

  return {
    providers,
    makeProvider,
    excelToJson: vi.fn(),
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    document: {
      convert: h.makeProvider('document.convert'),
      getFileMtime: h.makeProvider('document.getFileMtime'),
      saveAsDocx: h.makeProvider('document.saveAsDocx'),
      libreOffice: {
        isAvailable: h.makeProvider('document.libreOffice.isAvailable'),
      },
    },
  },
}));

vi.mock('@process/services/conversionService', () => ({
  conversionService: {
    excelToJson: h.excelToJson,
    wordToMarkdown: vi.fn(),
    wordToHtml: vi.fn(),
    pptToJson: vi.fn(),
    libreOfficeToPdf: vi.fn(),
    isLibreOfficeAvailable: vi.fn(),
    markdownToWordAndSave: vi.fn(),
  },
}));

beforeEach(() => {
  h.providers.clear();
  h.excelToJson.mockReset();
});

describe('documentBridge', () => {
  it('allows csv files through the excel-json conversion provider', async () => {
    const result = { success: true, data: { sheets: [{ name: 'Sheet1', data: [['name'], ['Ada']] }] } };
    h.excelToJson.mockResolvedValue(result);

    const { initDocumentBridge } = await import('@process/bridge/documentBridge');
    initDocumentBridge();

    await expect(h.providers.get('document.convert')?.({ filePath: '/workspace/scores.csv', to: 'excel-json' })).resolves.toEqual({
      to: 'excel-json',
      result,
    });
    expect(h.excelToJson).toHaveBeenCalledWith('/workspace/scores.csv');
  });
});
