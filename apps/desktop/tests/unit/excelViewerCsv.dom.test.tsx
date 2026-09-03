import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelViewer from '@/renderer/pages/conversation/preview/components/viewers/ExcelViewer';

const mocks = vi.hoisted(() => ({
  convert: vi.fn(),
  isLibreOfficeAvailable: vi.fn(),
  getFileMtime: vi.fn(),
  openFile: vi.fn(),
  install: vi.fn(),
  installProgressOn: vi.fn(),
  installResultOn: vi.fn(),
}));

const stableT = (key: string, options?: Record<string, unknown>) => {
  if (key === 'preview.excel.sheetCount') return `${options?.count} sheets`;
  return key;
};

let workbookData = {
  sheets: [
    {
      name: 'Sheet1',
      data: [
        ['name', 'score'],
        ['Ada', 99],
      ],
    },
  ],
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: stableT,
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    document: {
      convert: {
        invoke: mocks.convert,
      },
      getFileMtime: {
        invoke: mocks.getFileMtime,
      },
      libreOffice: {
        isAvailable: {
          invoke: mocks.isLibreOfficeAvailable,
        },
      },
    },
    shell: {
      openFile: {
        invoke: mocks.openFile,
      },
    },
  },
}));

vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  libreOffice: {
    install: {
      invoke: mocks.install,
    },
    installProgress: {
      on: mocks.installProgressOn,
    },
    installResult: {
      on: mocks.installResultOn,
    },
  },
}));

describe('ExcelViewer CSV preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workbookData = {
      sheets: [
        {
          name: 'Sheet1',
          data: [
            ['name', 'score'],
            ['Ada', 99],
          ],
        },
      ],
    };
    mocks.isLibreOfficeAvailable.mockResolvedValue(true);
    mocks.getFileMtime.mockResolvedValue(123);
    mocks.installProgressOn.mockReturnValue(() => undefined);
    mocks.installResultOn.mockReturnValue(() => undefined);
    mocks.convert.mockImplementation(({ to }) => {
      if (to === 'excel-json') {
        return Promise.resolve({
          to: 'excel-json',
          result: {
            success: true,
            data: workbookData,
          },
        });
      }
      return Promise.resolve({
        to,
        result: {
          success: false,
          error: 'CSV must not use LibreOffice PDF conversion',
        },
      });
    });
  });

  it('renders csv with JSON table data without invoking LibreOffice PDF conversion', async () => {
    render(<ExcelViewer filePath='/workspace/scores.csv' />);

    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument());

    expect(mocks.convert).toHaveBeenCalledWith({ filePath: '/workspace/scores.csv', to: 'excel-json' });
    expect(mocks.convert).not.toHaveBeenCalledWith({ filePath: '/workspace/scores.csv', to: 'libreoffice-pdf' });
    expect(mocks.isLibreOfficeAvailable).not.toHaveBeenCalled();
  });

  it('renders wide csv with JSON table data without showing LibreOffice install prompt', async () => {
    workbookData = {
      sheets: [
        {
          name: 'Sheet1',
          data: [
            ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'],
            ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'],
          ],
        },
      ],
    };

    render(<ExcelViewer filePath='/workspace/wide.csv' />);

    await waitFor(() => expect(screen.getByText('v7')).toBeInTheDocument());

    expect(screen.queryByText('preview.libreOffice.installPrompt')).not.toBeInTheDocument();
    expect(mocks.convert).not.toHaveBeenCalledWith({ filePath: '/workspace/wide.csv', to: 'libreoffice-pdf' });
    expect(mocks.isLibreOfficeAvailable).not.toHaveBeenCalled();
  });

  it('hides a leading generated-file intent marker row from csv table preview', async () => {
    workbookData = {
      sheets: [
        {
          name: 'Sheet1',
          data: [['# @final'], ['sample_id', 'score'], ['S001', 99]],
        },
      ],
    };

    render(<ExcelViewer filePath='/workspace/scores.csv' />);

    await waitFor(() => expect(screen.getByText('sample_id')).toBeInTheDocument());

    expect(screen.queryByText('# @final')).not.toBeInTheDocument();
    expect(screen.getByText('S001')).toBeInTheDocument();
  });
});
