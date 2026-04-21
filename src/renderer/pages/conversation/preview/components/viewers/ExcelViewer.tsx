/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { libreOffice as libreOfficeIpc } from '@/common/ipcBridge';
import type { ExcelWorkbookData } from '@/common/types/conversion';
import { usePreviewToolbarExtras } from '../../context/PreviewToolbarExtrasContext';
import { Button, Message } from '@arco-design/web-react';
import { IconRefresh } from '@arco-design/web-react/icon';
import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import PDFViewer from './PDFViewer';
import LibreOfficeInstallPrompt from '../LibreOfficeInstallPrompt';

interface ExcelPreviewProps {
  filePath?: string;
  content?: string;
  hideToolbar?: boolean;
}

// 缓存 Map / Cache Map
const pdfCache = new Map<string, { pdfPath: string; timestamp: number }>();
const CACHE_TIMEOUT = 5 * 60 * 1000; // 5 分钟

// 宽表格列数阈值 / Wide table column threshold
// 当列数超过此值时，使用 JSON 渲染（支持水平滚动）而非 PDF 预览
// When columns exceed this threshold, use JSON rendering (horizontal scroll) instead of PDF
const WIDE_TABLE_COLUMN_THRESHOLD = 6;

// A4 横向大约可容纳的字符宽度（半角字符数）
// Approximate character width that A4 landscape can fit
const LANDSCAPE_CHAR_WIDTH = 120;

/**
 * 估算表格内容的总字符宽度
 * Estimate total character width of table content
 *
 * 同时考虑列数和每列内容的实际宽度，比单纯看列数更精准
 * Considers both column count and actual content width for more accurate detection
 */
const estimateTableContentWidth = (sheets: ExcelWorkbookData['sheets']): number => {
  let maxEstimatedWidth = 0;

  for (const sheet of sheets) {
    // Sample first 50 rows to estimate width (avoid scanning huge datasets)
    const sampleRows = (sheet.data || []).slice(0, 50);

    for (const row of sampleRows) {
      if (!Array.isArray(row)) continue;
      let rowWidth = 0;
      for (const cell of row) {
        const cellStr = String(cell ?? '');
        // 中文/全角字符算 2 宽度，其他字符算 1 / CJK chars count as 2, others as 1
        const charWidth = [...cellStr].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x7f ? 2 : 1), 0);
        // 每个单元格最少 8 字符宽度（含 padding）/ Minimum 8 char width per cell (includes padding)
        rowWidth += Math.max(charWidth, 8);
      }
      maxEstimatedWidth = Math.max(maxEstimatedWidth, rowWidth);
    }
  }

  return maxEstimatedWidth;
};

/**
 * Excel 表格预览组件
 *
 * 优先使用 LibreOffice 转 PDF 预览，如果 LibreOffice 不可用则回退到 JSON 渲染
 */
const ExcelPreview: React.FC<ExcelPreviewProps> = ({ filePath, content: _content, hideToolbar = false }) => {
  const { t } = useTranslation();
  const [pdfPath, setPdfPath] = useState<string | undefined>(undefined);
  const [excelData, setExcelData] = useState<ExcelWorkbookData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [messageApi, messageContextHolder] = Message.useMessage();
  const toolbarExtrasContext = usePreviewToolbarExtras();
  const usePortalToolbar = Boolean(toolbarExtrasContext) && !hideToolbar;

  const [useLibreOffice, setUseLibreOffice] = useState<boolean>(false);
  const [needsLibreOfficeInstall, setNeedsLibreOfficeInstall] = useState(false);
  const [installingLibreOffice, setInstallingLibreOffice] = useState(false);
  const [installPercent, setInstallPercent] = useState<number | undefined>(undefined);
  const [installPhase, setInstallPhase] = useState<string | undefined>(undefined);
  const [reloadTrigger, setReloadTrigger] = useState(0);

  // Refs for install handler
  const filePathRef = useRef(filePath);
  const messageApiRef = useRef(messageApi);

  useEffect(() => {
    filePathRef.current = filePath;
  }, [filePath]);

  useEffect(() => {
    messageApiRef.current = messageApi;
  }, [messageApi]);

  const handleOpenInSystem = useCallback(async () => {
    if (!filePath) {
      messageApi.error(t('preview.errors.openWithoutPath'));
      return;
    }

    try {
      await ipcBridge.shell.openFile.invoke(filePath);
      messageApi.success(t('preview.openInSystemSuccess'));
    } catch (err) {
      messageApi.error(t('preview.openInSystemFailed'));
    }
  }, [filePath, messageApi, t]);

  const handleRefresh = useCallback(async () => {
    if (filePath) {
      pdfCache.delete(filePath); // 清除缓存
      setLoading(true);
      setError(null);
      setPdfPath(undefined);
      setExcelData(null);
      setRefreshing(true);

      try {
        if (useLibreOffice) {
          const response = await ipcBridge.document.convert.invoke({ filePath, to: 'libreoffice-pdf' });
          if (response.result.success && response.result.data) {
            setPdfPath(response.result.data as string);
            // 保存到缓存 / Save to cache
            pdfCache.set(filePath, { pdfPath: response.result.data as string, timestamp: Date.now() });
          }
        } else {
          const response = await ipcBridge.document.convert.invoke({ filePath, to: 'excel-json' });
          if (response.result.success && response.result.data) {
            setExcelData(response.result.data as ExcelWorkbookData);
            if ((response.result.data as ExcelWorkbookData).sheets.length > 0) {
              setActiveSheet((response.result.data as ExcelWorkbookData).sheets[0].name);
            }
          }
        }
      } catch (err) {
        messageApi.error(t('preview.excel.loadFailed'));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [filePath, useLibreOffice, messageApi, t]);

  const handleInstallLibreOffice = useCallback(async () => {
    setInstallingLibreOffice(true);
    setInstallPercent(undefined);
    setInstallPhase(undefined);
    try {
      const res = await libreOfficeIpc.install.invoke();
      if (!res?.success) {
        messageApiRef.current?.error?.(res?.msg || t('settings.runtimeSettings.installFailed', { name: 'LibreOffice' }));
      }
    } catch (e) {
      messageApiRef.current?.error?.(e instanceof Error ? e.message : t('settings.runtimeSettings.installFailed', { name: 'LibreOffice' }));
    }
    // Don't reset installingLibreOffice here — the installResult event will handle it
  }, [t]);

  // Listen for LibreOffice install progress and result
  useEffect(() => {
    const unsubProgress = libreOfficeIpc.installProgress.on(({ phase, percent }) => {
      setInstallingLibreOffice(true);
      setInstallPhase(phase);
      if (percent != null) setInstallPercent((prev) => (prev != null ? Math.max(prev, percent) : percent));
    });
    const unsubResult = libreOfficeIpc.installResult.on(() => {
      setInstallingLibreOffice(false);
      setInstallPercent(undefined);
      setInstallPhase(undefined);
      if (needsLibreOfficeInstall) {
        setNeedsLibreOfficeInstall(false);
        setReloadTrigger((n) => n + 1);
      }
    });
    return () => {
      unsubProgress();
      unsubResult();
    };
  }, [needsLibreOfficeInstall]);

  useEffect(() => {
    const loadExcel = async () => {
      if (!filePath) {
        setError(t('preview.errors.missingFilePath'));
        setLoading(false);
        return;
      }

      // 检查缓存 / Check cache
      const cached = pdfCache.get(filePath);
      if (cached && Date.now() - cached.timestamp < CACHE_TIMEOUT) {
        console.log('[ExcelViewer] Cache hit:', filePath);
        setUseLibreOffice(true); // 设置 LibreOffice 状态，因为缓存的是 PDF
        setPdfPath(cached.pdfPath);
        setLoading(false);
        return;
      }
      if (cached) {
        pdfCache.delete(filePath);
      }

      setLoading(true);
      setError(null);

      try {
        // 先获取 Excel JSON 数据以检测列数 / First get Excel JSON data to check column count
        const jsonResponse = await ipcBridge.document.convert.invoke({ filePath, to: 'excel-json' });

        if (jsonResponse.result.success && jsonResponse.result.data) {
          const workbookData = jsonResponse.result.data as ExcelWorkbookData;
          setExcelData(workbookData);

          if (workbookData.sheets.length > 0) {
            setActiveSheet(workbookData.sheets[0].name);
          }

          // 检测是否为宽表格 / Check if it's a wide table
          // 综合列数和内容宽度进行判断 / Consider both column count and content width
          const maxColumns = workbookData.sheets.reduce((max, sheet) => {
            const sheetMax = (sheet.data || []).reduce((rowMax, row) => {
              return Math.max(rowMax, Array.isArray(row) ? row.length : 0);
            }, 0);
            return Math.max(max, sheetMax);
          }, 0);

          const estimatedWidth = estimateTableContentWidth(workbookData.sheets);

          // 宽表格判定：列数超过阈值 或 内容宽度超过 A4 横向可容纳宽度
          // Wide table: column count exceeds threshold OR content width exceeds A4 landscape capacity
          const isWideTable = maxColumns > WIDE_TABLE_COLUMN_THRESHOLD || estimatedWidth > LANDSCAPE_CHAR_WIDTH;
          console.log('[ExcelViewer] Max columns:', maxColumns, 'estimatedWidth:', estimatedWidth, 'isWideTable:', isWideTable);

          // 检查 LibreOffice 是否可用 / Check LibreOffice availability
          const libreOfficeAvailable = await ipcBridge.document.libreOffice.isAvailable.invoke();

          // 决策：宽表格优先使用 JSON 渲染（支持水平滚动），否则用 PDF
          // Decision: Wide tables prefer JSON rendering (horizontal scroll), otherwise PDF
          const shouldUsePdf = libreOfficeAvailable && !isWideTable;
          setUseLibreOffice(shouldUsePdf);

          if (shouldUsePdf) {
            // LibreOffice 可用且非宽表格：转换为 PDF / LibreOffice available and not wide: convert to PDF
            const pdfResponse = await ipcBridge.document.convert.invoke({ filePath, to: 'libreoffice-pdf' });

            if (pdfResponse.to !== 'libreoffice-pdf') {
              throw new Error(t('preview.errors.conversionFailed'));
            }

            if (pdfResponse.result.success && pdfResponse.result.data) {
              setPdfPath(pdfResponse.result.data);
              // 保存到缓存 / Save to cache
              pdfCache.set(filePath, { pdfPath: pdfResponse.result.data, timestamp: Date.now() });
              console.log('[ExcelViewer] Converted and cached:', filePath);
            } else {
              // PDF 转换失败，回退到 JSON 渲染 / PDF conversion failed, fallback to JSON
              setUseLibreOffice(false);
              throw new Error(pdfResponse.result.error || t('preview.excel.convertFailed'));
            }
          } else if (isWideTable && !libreOfficeAvailable) {
            // 宽表格且 LibreOffice 不可用：提示安装 / Wide table and no LibreOffice: prompt install
            setNeedsLibreOfficeInstall(true);
            setLoading(false);
            return;
          } else {
            // LibreOffice 不可用但非宽表格：使用 JSON 渲染 / No LibreOffice but not wide: use JSON
            console.log('[ExcelViewer] Using JSON rendering (no LibreOffice)');
          }
        } else {
          throw new Error(jsonResponse.result.error || t('preview.excel.loadFailed'));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('preview.excel.loadFailed'));
      } finally {
        setLoading(false);
      }
    };

    void loadExcel();
  }, [filePath, t, reloadTrigger]);

  const sheetCount = excelData?.sheets.length;

  // Memoize toolbar content to prevent infinite re-renders
  const toolbarLeft = useMemo(
    () => (
      <div className='flex items-center gap-8px'>
        <span className='text-13px text-t-secondary'>📊 {t('preview.excel.title')}</span>
        <span className='text-11px text-t-tertiary'>{t('preview.readOnlyLabel')}</span>
        {typeof sheetCount === 'number' && <span className='text-12px text-t-secondary'>{t('preview.excel.sheetCount', { count: sheetCount })}</span>}
      </div>
    ),
    [sheetCount] // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (!usePortalToolbar || !toolbarExtrasContext) return;
    toolbarExtrasContext.setExtras({
      left: toolbarLeft,
      right: null,
    });
    return () => toolbarExtrasContext.setExtras(null);
  }, [usePortalToolbar, toolbarExtrasContext, toolbarLeft]);

  /**
   * 渲染工作表数据为 HTML 表格
   */
  const renderSheetTable = (sheetName: string) => {
    const sheet = excelData?.sheets.find((s) => s.name === sheetName);
    const hasTableData = !!sheet?.data && sheet.data.length > 0;
    const sheetImages = sheet?.images || [];

    if (!hasTableData && sheetImages.length === 0) {
      return (
        <div className='flex items-center justify-center h-200px'>
          <div className='text-center'>
            <div className='text-14px text-t-secondary mb-8px'>{t('preview.excel.emptySheet')}</div>
            <div className='text-12px text-t-tertiary'>{t('preview.excel.emptySheetHint')}</div>
          </div>
        </div>
      );
    }

    const rows = hasTableData && sheet ? sheet.data : [[]];
    const imageMap = new Map<string, typeof sheetImages>();
    const rowImageMaxCols = new Map<number, number>();
    let maxImageRow = -1;
    sheetImages.forEach((img) => {
      const key = `${img.row}-${img.col}`;
      const list = imageMap.get(key) || [];
      list.push(img);
      imageMap.set(key, list);
      const existingMax = rowImageMaxCols.get(img.row) ?? 0;
      if (img.col + 1 > existingMax) {
        rowImageMaxCols.set(img.row, img.col + 1);
      }
      if (img.row > maxImageRow) {
        maxImageRow = img.row;
      }
    });

    const maxColumnsFromData = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
    const maxColumnsFromMerges = (sheet?.merges || []).reduce((max, merge) => Math.max(max, (merge?.e?.c ?? 0) + 1), 0);
    const maxColumnsFromImages = rowImageMaxCols.size > 0 ? Math.max(...rowImageMaxCols.values()) : 0;
    const totalColumns = Math.max(1, maxColumnsFromData, maxColumnsFromMerges, maxColumnsFromImages);

    const maxRowFromMerges = (sheet?.merges || []).reduce((max, merge) => Math.max(max, (merge?.e?.r ?? 0) + 1), 0);
    const totalRows = Math.max(rows.length, maxImageRow + 1, maxRowFromMerges);

    const mergeMap = new Map<string, { colSpan: number; rowSpan: number }>();
    const skipCells = new Set<string>();
    (sheet?.merges || []).forEach((merge) => {
      const start = merge.s;
      const end = merge.e;
      const colSpan = (end.c ?? start.c) - (start.c ?? 0) + 1;
      const rowSpan = (end.r ?? start.r) - (start.r ?? 0) + 1;
      const key = `${start.r}-${start.c}`;
      mergeMap.set(key, { colSpan, rowSpan });

      for (let r = start.r; r <= end.r; r += 1) {
        for (let c = start.c; c <= end.c; c += 1) {
          if (r === start.r && c === start.c) continue;
          skipCells.add(`${r}-${c}`);
        }
      }
    });

    const renderCellContent = (value: unknown, cellImages?: typeof sheetImages) => {
      const text = value === undefined || value === null ? '' : String(value);
      const hasText = text !== '';
      const hasImages = !!cellImages && cellImages.length > 0;
      if (!hasText && !hasImages) return null;

      return (
        <div className='flex flex-col gap-4px'>
          {hasText && <span>{text}</span>}
          {cellImages?.map((img, idx) => {
            const maxWidth = img.width ? Math.min(img.width, 240) : 160;
            const maxHeight = img.height ? Math.min(img.height, 200) : 120;
            return (
              <img
                key={`${img.col}-${img.row}-${idx}`}
                src={img.src}
                alt={img.alt || 'cell image'}
                style={{
                  maxWidth: `${maxWidth}px`,
                  maxHeight: `${maxHeight}px`,
                  width: img.width ? `${Math.min(img.width, 240)}px` : 'auto',
                  height: img.height ? `${Math.min(img.height, 200)}px` : 'auto',
                  objectFit: 'contain',
                  borderRadius: '4px',
                  backgroundColor: 'var(--bg-1)',
                }}
              />
            );
          })}
        </div>
      );
    };

    return (
      <div className='w-full h-full overflow-auto p-10px bg-bg-1'>
        <div className='relative inline-block min-w-full'>
          <table
            className='border-collapse text-13px text-t-primary'
            style={{
              borderCollapse: 'collapse',
              border: '1px solid var(--color-border-2, #d4d4d8)',
            }}
          >
            <tbody>
              {Array.from({ length: totalRows }).map((_, rowIndex) => {
                const rowData = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
                const rowKey = `${sheetName}-row-${rowIndex}`;
                const backgroundColor = rowIndex % 2 === 0 ? 'var(--color-bg-1, #ffffff)' : 'var(--color-fill-1, #f2f3f5)';

                return (
                  <tr key={rowKey} style={{ backgroundColor }}>
                    {Array.from({ length: totalColumns }).map((_, colIndex) => {
                      const cellKey = `${rowIndex}-${colIndex}`;
                      if (skipCells.has(cellKey)) {
                        return null;
                      }

                      const mergeInfo = mergeMap.get(cellKey);
                      const value = rowData[colIndex];
                      const cellImages = imageMap.get(cellKey);
                      const content = renderCellContent(value, cellImages);

                      return (
                        <td
                          key={cellKey}
                          colSpan={mergeInfo?.colSpan}
                          rowSpan={mergeInfo?.rowSpan}
                          className='px-12px py-8px whitespace-pre-wrap align-top'
                          style={{
                            border: '1px solid var(--color-border-2, #d4d4d8)',
                            minWidth: '100px',
                            backgroundColor,
                          }}
                        >
                          {content}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className='flex items-center justify-center h-full'>
        <div className='text-14px text-t-secondary'>{t('preview.excel.loading')}</div>
      </div>
    );
  }

  if (needsLibreOfficeInstall) {
    return (
      <div className='h-full w-full'>
        <LibreOfficeInstallPrompt
          fileType='excel'
          installing={installingLibreOffice}
          percent={installPercent}
          phase={installPhase}
          onInstall={handleInstallLibreOffice}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex items-center justify-center h-full'>
        <div className='text-center'>
          <div className='text-16px text-t-error mb-8px'>❌ {error}</div>
          <div className='text-12px text-t-secondary'>{t('preview.excel.invalid')}</div>
        </div>
      </div>
    );
  }

  // LibreOffice 可用：显示 PDF 预览
  if (useLibreOffice && pdfPath) {
    return (
      <div className='h-full w-full flex flex-col'>
        {messageContextHolder}

        {!usePortalToolbar && !hideToolbar && (
          <div className='flex items-center justify-between h-40px px-12px bg-bg-2 border-b border-border-base flex-shrink-0'>
            <div className='flex items-center gap-8px'>
              <span className='text-13px text-t-secondary'>📊 {t('preview.excel.title')}</span>
              <span className='text-11px text-t-tertiary'>{t('preview.readOnlyLabel')}</span>
            </div>

            <div className='flex items-center gap-8px'>
              {filePath && (
                <Button size='mini' type='text' onClick={handleOpenInSystem} title={t('preview.openWithApp', { app: 'Excel' })}>
                  <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                    <path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' />
                    <polyline points='15 3 21 3 21 9' />
                    <line x1='10' y1='14' x2='21' y2='3' />
                  </svg>
                  <span>{t('preview.openWithApp', { app: 'Excel' })}</span>
                </Button>
              )}
              <Button size='mini' type='text' onClick={handleRefresh} loading={refreshing} title={t('preview.refresh')} style={{ padding: '4px' }}>
                <IconRefresh />
              </Button>
            </div>
          </div>
        )}

        <div className='flex-1 overflow-hidden'>{pdfPath && <PDFViewer filePath={pdfPath} hideToolbar />}</div>
      </div>
    );
  }

  // LibreOffice 不可用：显示 JSON 渲染的表格
  if (!excelData || excelData.sheets.length === 0) {
    return (
      <div className='flex items-center justify-center h-full'>
        <div className='text-14px text-t-secondary'>{t('preview.excel.noSheets')}</div>
      </div>
    );
  }

  return (
    <div className='h-full w-full flex flex-col'>
      {messageContextHolder}

      {!usePortalToolbar && !hideToolbar && (
        <div className='flex items-center justify-between h-40px px-12px bg-bg-2 border-b border-border-base flex-shrink-0'>
          <div className='flex items-center gap-8px'>
            <span className='text-13px text-t-secondary'>📊 {t('preview.excel.title')}</span>
            <span className='text-11px text-t-tertiary'>{t('preview.readOnlyLabel')}</span>
          </div>

          <div className='flex items-center gap-8px'>
            <span className='text-12px text-t-secondary'>{t('preview.excel.sheetCount', { count: excelData.sheets.length })}</span>
            {filePath && (
              <Button size='mini' type='text' onClick={handleOpenInSystem} title={t('preview.openWithApp', { app: 'Excel' })}>
                <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                  <path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' />
                  <polyline points='15 3 21 3 21 9' />
                  <line x1='10' y1='14' x2='21' y2='3' />
                </svg>
                <span>{t('preview.openWithApp', { app: 'Excel' })}</span>
              </Button>
            )}
            <Button size='mini' type='text' onClick={handleRefresh} loading={refreshing} title={t('preview.refresh')} style={{ padding: '4px' }}>
              <IconRefresh />
            </Button>
          </div>
        </div>
      )}

      <div className='flex-1 overflow-hidden flex flex-col bg-bg-1'>
        {excelData.sheets.length === 1 ? (
          renderSheetTable(excelData.sheets[0].name)
        ) : (
          <>
            <div className='flex items-center h-28px px-8px bg-bg-1 border-b border-border-base overflow-x-auto flex-shrink-0'>
              {excelData.sheets.map((sheet) => (
                <button
                  key={sheet.name}
                  type='button'
                  className='px-12px h-24px flex items-center cursor-pointer text-11px whitespace-nowrap transition-colors'
                  style={{
                    color: activeSheet === sheet.name ? 'var(--color-text-1)' : 'var(--color-text-3)',
                    backgroundColor: activeSheet === sheet.name ? 'var(--color-bg-2)' : 'transparent',
                    fontWeight: activeSheet === sheet.name ? 500 : 400,
                    borderRadius: '2px',
                    border: 'none',
                    outline: 'none',
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setActiveSheet(sheet.name);
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                >
                  {sheet.name}
                </button>
              ))}
            </div>
            <div className='flex-1 overflow-hidden' key={activeSheet}>
              {renderSheetTable(activeSheet)}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ExcelPreview;
