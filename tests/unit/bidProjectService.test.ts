import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IBidProjectDetail } from '@/common/bid-projects/types';

vi.mock('@process/database', () => ({
  getDatabase: vi.fn(),
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainError: vi.fn(),
}));

vi.mock('@process/services/conversionService', () => ({
  conversionService: {
    libreOfficeToPdf: vi.fn(),
  },
}));

vi.mock('@process/bridge/difyBridge', () => ({
  callGetEnhancement: vi.fn(),
  callInvokeEnhancement: vi.fn(),
  callStartEnhancementStream: vi.fn(),
}));

vi.mock('@process/bridge/imageGenerationBridge', () => ({
  readSudorouterCredentials: vi.fn(),
}));

const { DocumentConverter } = await import('@/common/document/DocumentConverter');
const { buildUnicomDirectProcurementMarkdown, bidProjectService } = await import('@/process/services/bid-projects/BidProjectService');
const { getDatabase } = await import('@process/database');

type MockDb = {
  prepare: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
};

function createDetail(overrides?: Partial<IBidProjectDetail>): IBidProjectDetail {
  return {
    project: {
      id: 'bid-1',
      name: '2025年安徽联通某客户数据综合服务采购项目',
      company: '中国联通安徽省分公司',
      budget: '200万元',
      projectType: '服务采购',
      target: '某客户数据综合服务',
      duration: '自合同签订之日起12个月',
      procurementMethod: '直接采购',
      remark: '需补充采购代理机构信息',
      status: 'generated',
      selectedTemplate: '联通直接采购模板',
      currentDraftId: 'draft-1',
      currentVersion: 'V1.0',
      createdAt: new Date('2026-07-12T00:00:00.000Z').getTime(),
      updatedAt: new Date('2026-07-12T00:00:00.000Z').getTime(),
    },
    sources: [
      {
        id: 'source-1',
        projectId: 'bid-1',
        fileName: 'source.txt',
        filePath: '/tmp/source.txt',
        mimeType: 'text/plain',
        size: 256,
        parseStatus: 'success',
        parseError: null,
        extractedText: ['联系人：张三', '联系电话：13800138000', '电子邮箱：zhangsan@example.com', '地点：安徽合肥'].join('\n'),
        summary: '项目名称、采购人、预算金额、联系人等关键信息完整。',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    facts: [
      {
        id: 'fact-1',
        projectId: 'bid-1',
        fieldName: 'company',
        candidateValue: '中国联通安徽省分公司',
        confidence: 0.92,
        sourceFileId: 'source-1',
        sourceSnippet: '采购人：中国联通安徽省分公司',
        status: 'confirmed',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'fact-2',
        projectId: 'bid-1',
        fieldName: 'procurementMethod',
        candidateValue: '直接采购',
        confidence: 0.92,
        sourceFileId: 'source-1',
        sourceSnippet: '采购方式：直接采购',
        status: 'confirmed',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    currentDraft: {
      id: 'draft-1',
      projectId: 'bid-1',
      version: 'V1.0',
      markdown: '',
      status: 'generated',
      createdAt: 1,
      updatedAt: 1,
    },
    ...overrides,
  };
}

function createMockDb(): MockDb {
  return {
    prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() })),
    transaction: vi.fn((callback: () => void) => callback),
  };
}

describe('buildUnicomDirectProcurementMarkdown', () => {
  it('builds a complete direct procurement markdown draft', () => {
    const markdown = buildUnicomDirectProcurementMarkdown(createDetail());

    expect(markdown).toContain('# 直接采购文件');
    expect(markdown).toContain('## 目录');
    expect(markdown).toContain('## 第一章 邀请函');
    expect(markdown).toContain('## 第二章 应答人须知');
    expect(markdown).toContain('## 第三章 采购合同');
    expect(markdown).toContain('## 第四章 技术规范书');
    expect(markdown).toContain('## 第五章 应答文件格式');
    expect(markdown).toContain('| 采购人 | 中国联通安徽省分公司 |');
    expect(markdown).toContain('| 预算/限价 | 200万元 |');
    expect(markdown).toContain('联系人：张三，联系电话：13800138000，电子邮箱：zhangsan@example.com。');
    expect(markdown).toContain('| 服务地点 | 安徽合肥 |');
    expect(markdown).toContain('某客户数据综合服务');
    expect(markdown).toContain('### 应答文件编制要求');
    expect(markdown).toContain('### 报价要求');
    expect(markdown).toContain('### 无效应答情形');
    expect(markdown).toContain('### 服务保障要求');
    expect(markdown).toContain('### 商务偏离表（示例）');
  });

  it('renders summaries and confirmed facts into the technical section', () => {
    const markdown = buildUnicomDirectProcurementMarkdown(createDetail());

    expect(markdown).toContain('### 材料摘要');
    expect(markdown).toContain('**source.txt**');
    expect(markdown).toContain('项目名称、采购人、预算金额、联系人等关键信息完整。');
    expect(markdown).toContain('### 已确认字段');
    expect(markdown).toContain('**company**：中国联通安徽省分公司');
    expect(markdown).toContain('**procurementMethod**：直接采购');
    expect(markdown).toContain('### 待补充事项');
  });

  it('exports generated markdown to a docx buffer', async () => {
    const converter = new DocumentConverter();
    const markdown = buildUnicomDirectProcurementMarkdown(createDetail());

    const buffer = await converter.markdownToWord(markdown);

    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(buffer.byteLength).toBeGreaterThan(0);
  });
});

describe('bidProjectService.generateAiSections', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('falls back to rule section markdown when no token or assistant id is provided', async () => {
    const detail = createDetail({
      currentDraft: {
        id: 'draft-1',
        projectId: 'bid-1',
        version: 'V1.0',
        markdown: buildUnicomDirectProcurementMarkdown(createDetail()),
        status: 'generated',
        createdAt: 1,
        updatedAt: 1,
      },
    });
    const mockDb = createMockDb();
    vi.mocked(getDatabase).mockReturnValue({ db: mockDb } as any);
    const getProjectSpy = vi
      .spyOn(bidProjectService, 'getProject')
      .mockReturnValueOnce(detail)
      .mockReturnValueOnce({
        ...detail,
        currentDraft: {
          ...detail.currentDraft!,
          markdown: buildUnicomDirectProcurementMarkdown(detail),
        },
      });

    const result = await bidProjectService.generateAiSections({
      projectId: 'bid-1',
      sectionKeys: ['notice'],
    });

    expect(result?.generatedSections).toHaveLength(1);
    expect(result?.generatedSections[0]?.fallbackUsed).toBe(true);
    expect(result?.generatedSections[0]?.markdown).toContain('### 项目概况');
    getProjectSpy.mockRestore();
  });

  it('falls back when enhancement probe hangs', async () => {
    const detail = createDetail({
      currentDraft: {
        id: 'draft-1',
        projectId: 'bid-1',
        version: 'V1.0',
        markdown: buildUnicomDirectProcurementMarkdown(createDetail()),
        status: 'generated',
        createdAt: 1,
        updatedAt: 1,
      },
    });
    const mockDb = createMockDb();
    vi.mocked(getDatabase).mockReturnValue({ db: mockDb } as any);
    const getProjectSpy = vi.spyOn(bidProjectService, 'getProject').mockReturnValueOnce(detail).mockReturnValueOnce(detail);
    const { callGetEnhancement } = await import('@process/bridge/difyBridge');
    vi.mocked(callGetEnhancement).mockImplementation(
      () =>
        new Promise(() => {
          // never resolves
        }) as any
    );
    vi.useFakeTimers();

    const resultPromise = bidProjectService.generateAiSections({
      projectId: 'bid-1',
      sectionKeys: ['notice'],
      accessToken: 'token',
      assistantId: 'assistant-id',
    });

    await vi.advanceTimersByTimeAsync(15001);
    const result = await resultPromise;

    expect(result?.generatedSections).toHaveLength(1);
    expect(result?.generatedSections[0]?.fallbackUsed).toBe(true);
    getProjectSpy.mockRestore();
    vi.useRealTimers();
  });

  it('falls back to direct model generation when enhancement is unavailable', async () => {
    const detail = createDetail({
      currentDraft: {
        id: 'draft-1',
        projectId: 'bid-1',
        version: 'V1.0',
        markdown: buildUnicomDirectProcurementMarkdown(createDetail()),
        status: 'generated',
        createdAt: 1,
        updatedAt: 1,
      },
    });
    const mockDb = createMockDb();
    vi.mocked(getDatabase).mockReturnValue({ db: mockDb } as any);
    const getProjectSpy = vi.spyOn(bidProjectService, 'getProject').mockReturnValueOnce(detail).mockReturnValueOnce(detail);
    const { callGetEnhancement } = await import('@process/bridge/difyBridge');
    const { readSudorouterCredentials } = await import('@process/bridge/imageGenerationBridge');
    vi.mocked(callGetEnhancement).mockResolvedValue({
      success: false,
    } as any);
    vi.mocked(readSudorouterCredentials).mockReturnValue({
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'proxy-key',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '### AI 邀请函\n- 请按要求参加应答。',
            },
          },
        ],
      }),
    } as any);

    const result = await bidProjectService.generateAiSections({
      projectId: 'bid-1',
      sectionKeys: ['notice'],
      accessToken: 'token',
      assistantId: 'assistant-id',
    });

    expect(result?.generatedSections).toHaveLength(1);
    expect(result?.generatedSections[0]?.fallbackUsed).toBe(false);
    expect(result?.generatedSections[0]?.markdown).toContain('AI 邀请函');
    getProjectSpy.mockRestore();
  });

  it('replaces only the target section content', async () => {
    const originalMarkdown = buildUnicomDirectProcurementMarkdown(createDetail());
    const detail = createDetail({
      currentDraft: {
        id: 'draft-1',
        projectId: 'bid-1',
        version: 'V1.0',
        markdown: originalMarkdown,
        status: 'generated',
        createdAt: 1,
        updatedAt: 1,
      },
    });
    const mockDb = createMockDb();
    vi.mocked(getDatabase).mockReturnValue({ db: mockDb } as any);
    const getProjectSpy = vi
      .spyOn(bidProjectService, 'getProject')
      .mockReturnValueOnce(detail)
      .mockReturnValueOnce({
        ...detail,
        currentDraft: {
          ...detail.currentDraft!,
          markdown: originalMarkdown.replace('### 建设目标', '### AI 技术规范'),
        },
      });
    const { callGetEnhancement, callInvokeEnhancement } = await import('@process/bridge/difyBridge');
    vi.mocked(callGetEnhancement).mockResolvedValue({
      success: true,
      data: {
        enabled: true,
        mode: 'agent-chat',
      },
    } as any);
    vi.mocked(callInvokeEnhancement).mockResolvedValue({
      success: true,
      data: {
        text: '### AI 技术规范\n- 新的技术要求',
        mode: 'agent-chat',
        elapsedMs: 12,
      },
    } as any);

    const result = await bidProjectService.generateAiSections({
      projectId: 'bid-1',
      sectionKeys: ['technical'],
      accessToken: 'token',
      assistantId: 'assistant-id',
    });

    expect(result?.generatedSections[0]?.fallbackUsed).toBe(false);
    const savedMarkdown = mockDb.prepare.mock.results[0]?.value.run.mock.calls[0]?.[0] as string;
    expect(savedMarkdown).toContain('### AI 技术规范');
    expect(savedMarkdown).toContain('## 第一章 邀请函');
    expect(savedMarkdown).toContain('## 第五章 应答文件格式');
    getProjectSpy.mockRestore();
  });
});
