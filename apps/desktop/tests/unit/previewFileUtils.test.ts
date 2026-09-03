import { describe, expect, it } from 'vitest';
import { getContentTypeByExtension } from '@renderer/pages/conversation/preview/utils/fileUtils';

describe('preview fileUtils', () => {
  it('maps csv files to excel preview type for table rendering', () => {
    expect(getContentTypeByExtension('/workspace/report.csv')).toBe('excel');
    expect(getContentTypeByExtension('/workspace/report.CSV')).toBe('excel');
  });

  it('keeps existing office spreadsheet mappings unchanged', () => {
    expect(getContentTypeByExtension('/workspace/report.xls')).toBe('excel');
    expect(getContentTypeByExtension('/workspace/report.xlsx')).toBe('excel');
    expect(getContentTypeByExtension('/workspace/report.ods')).toBe('excel');
  });
});
