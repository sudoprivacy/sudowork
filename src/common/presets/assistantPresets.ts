import type { PresetAgentType } from '@/types/acpTypes';

export type AssistantPreset = {
  id: string;
  avatar: string;
  presetAgentType?: PresetAgentType;
  /**
   * Directory containing all resources for this preset (relative to project root).
   * If set, both ruleFiles and skillFiles will be resolved from this directory.
   * Default: rules/ for rules, skills/ for skills
   */
  resourceDir?: string;
  ruleFiles: Record<string, string>;
  skillFiles?: Record<string, string>;
  /**
   * Default enabled skills for this assistant (skill names from skills/ directory).
   * 此助手默认启用的技能列表（来自 skills/ 目录的技能名称）
   */
  defaultEnabledSkills?: string[];
  /**
   * Default agent mode for this assistant (e.g., 'yolo' for auto-approve).
   * Applied when creating a new conversation — user can override via mode selector.
   */
  defaultMode?: string;
  /**
   * Path to an ops entry point script (e.g. 'tests/e2e/run_op.py').
   * When set, direct ai-dev-browser CLI calls are redirected through this wrapper.
   */
  opsEntryPoint?: string;
  /**
   * Gemini CLI model config overrides (temperature, thinkingBudget, etc).
   * Written to .gemini/settings.json in the conversation workspace before CLI starts.
   * See: node_modules/@office-ai/aioncli-core/dist/docs/cli/generation-settings.md
   */
  modelConfigs?: Record<string, unknown>;
  /**
   * API Key fields for Settings UI. Values are injected as env vars when spawning.
   */
  apiKeyFields?: Array<{
    key: string;
    label: string;
    type: 'text' | 'password' | 'select' | 'number' | 'boolean';
    required?: boolean;
    options?: string[];
    default?: string | number | boolean;
  }>;
  nameI18n: Record<string, string>;
  descriptionI18n: Record<string, string>;
  promptsI18n?: Record<string, string[]>;
  /**
   * Default initial prompt to pre-fill input when selecting this assistant.
   * 选择此助手时预填到输入框的默认提示词。
   */
  defaultInitPrompt?: string;
};

export const ASSISTANT_PRESETS: AssistantPreset[] = [
  {
    id: 'cowork',
    avatar: 'cowork.svg',
    presetAgentType: 'scode',
    resourceDir: 'assistant/cowork',
    ruleFiles: {
      'en-US': 'cowork.md',
      'zh-CN': 'cowork.md', // 使用同一个文件，内容已精简 / Use same file, content is simplified
    },
    skillFiles: {
      'en-US': 'cowork-skills.md',
      'zh-CN': 'cowork-skills.zh-CN.md',
    },
    defaultEnabledSkills: ['skill-creator', 'pptx', 'pdf'],
    nameI18n: {
      'en-US': 'Cowork',
      'zh-CN': 'Cowork',
    },
    descriptionI18n: {
      'en-US': 'Autonomous task execution with file operations, document processing, and multi-step workflow planning.',
      'zh-CN': '具有文件操作、文档处理和多步骤工作流规划的自主任务执行助手。',
    },
    promptsI18n: {
      'en-US': ['Analyze the current project structure and suggest improvements', 'Automate the build and deployment process', 'Extract and summarize key information from all PDF files'],
      'zh-CN': ['分析当前项目结构并建议改进方案', '自动化构建和部署流程', '提取并总结所有 PDF 文件的关键信息'],
    },
  },
  {
    id: 'ui-ux-pro-max',
    avatar: '🎨',
    presetAgentType: 'scode',
    resourceDir: 'assistant/ui-ux-pro-max',
    ruleFiles: {
      'en-US': 'ui-ux-pro-max.md',
      'zh-CN': 'ui-ux-pro-max.zh-CN.md',
    },
    nameI18n: {
      'en-US': 'UI/UX Pro Max',
      'zh-CN': 'UI/UX 专业设计师',
    },
    descriptionI18n: {
      'en-US': 'Professional UI/UX design intelligence with 57 styles, 95 color palettes, 56 font pairings, and stack-specific best practices.',
      'zh-CN': '专业 UI/UX 设计智能助手，包含 57 种风格、95 个配色方案、56 个字体配对及技术栈最佳实践。',
    },
    promptsI18n: {
      'en-US': ['Design a modern login page for a fintech mobile app', 'Create a color palette for a nature-themed website', 'Design a dashboard interface for a SaaS product'],
      'zh-CN': ['为金融科技移动应用设计现代登录页', '创建自然主题网站的配色方案', '为 SaaS 产品设计仪表板界面'],
    },
  },
  {
    id: 'planning-with-files',
    avatar: '📋',
    presetAgentType: 'scode',
    resourceDir: 'assistant/planning-with-files',
    ruleFiles: {
      'en-US': 'planning-with-files.md',
      'zh-CN': 'planning-with-files.zh-CN.md',
    },
    nameI18n: {
      'en-US': 'Planning with Files',
      'zh-CN': '文件规划助手',
    },
    descriptionI18n: {
      'en-US': 'Manus-style file-based planning for complex tasks. Uses task_plan.md, findings.md, and progress.md to maintain persistent context.',
      'zh-CN': 'Manus 风格的文件规划，用于复杂任务。使用 task_plan.md、findings.md 和 progress.md 维护持久化上下文。',
    },
    promptsI18n: {
      'en-US': ['Plan a comprehensive refactoring task with milestones', 'Break down the feature implementation into actionable steps', 'Create a project plan for migrating to a new framework'],
      'zh-CN': ['规划一个包含里程碑的全面重构任务', '将功能实现拆分为可执行的步骤', '创建迁移到新框架的项目计划'],
    },
  },
  {
    id: 'human-3-coach',
    avatar: '🧭',
    presetAgentType: 'scode',
    resourceDir: 'assistant/human-3-coach',
    ruleFiles: {
      'en-US': 'human-3-coach.md',
      'zh-CN': 'human-3-coach.zh-CN.md',
    },
    nameI18n: {
      'en-US': 'HUMAN 3.0 Coach',
      'zh-CN': 'HUMAN 3.0 教练',
    },
    descriptionI18n: {
      'en-US': 'Personal development coach based on HUMAN 3.0 framework: 4 Quadrants (Mind/Body/Spirit/Vocation), 3 Levels, 3 Growth Phases.',
      'zh-CN': '基于 HUMAN 3.0 框架的个人发展教练：4 象限（思维/身体/精神/职业）、3 层次、3 成长阶段。',
    },
    promptsI18n: {
      'en-US': ['Help me set quarterly goals across all life quadrants', 'Reflect on my career progress and plan next steps', 'Create a personal development plan for the next 3 months'],
      'zh-CN': ['帮我设定涵盖所有生活象限的季度目标', '反思我的职业发展进度并规划下一步', '为未来 3 个月创建个人发展计划'],
    },
  },
  {
    id: 'beautiful-mermaid',
    avatar: '📈',
    presetAgentType: 'scode',
    resourceDir: 'assistant/beautiful-mermaid',
    ruleFiles: {
      'en-US': 'beautiful-mermaid.md',
      'zh-CN': 'beautiful-mermaid.zh-CN.md',
    },
    defaultEnabledSkills: ['mermaid'],
    nameI18n: {
      'en-US': 'Beautiful Mermaid',
      'zh-CN': 'Beautiful Mermaid',
    },
    descriptionI18n: {
      'en-US': 'Create flowcharts, sequence diagrams, state diagrams, class diagrams, and ER diagrams with beautiful themes.',
      'zh-CN': '创建流程图、时序图、状态图、类图和 ER 图，支持多种精美主题。',
    },
    promptsI18n: {
      'en-US': ['Draw a detailed user login authentication flowchart', 'Create an API sequence diagram for payment processing', 'Create a system architecture diagram'],
      'zh-CN': ['绘制详细的用户登录认证流程图', '创建支付处理的 API 时序图', '创建系统架构图'],
    },
  },
  {
    id: 'copilot',
    avatar: '🧭',
    presetAgentType: 'scode',
    resourceDir: 'assistant/copilot',
    ruleFiles: {
      'en-US': 'copilot.md',
      'zh-CN': 'copilot.zh-CN.md',
    },
    nameI18n: {
      'en-US': 'Copilot',
      'zh-CN': 'Copilot',
    },
    descriptionI18n: {
      'en-US': 'Task orchestration assistant. Analyzes input, decomposes complex tasks into a DAG, writes to the filesystem, and lets the Worker Pool execute asynchronously.',
      'zh-CN': '任务编排助手。分析输入、将复杂任务拆分为 DAG 写入文件系统，由 Worker Pool 异步调度执行，Copilot 与 Worker 通过文件解耦。',
    },
    promptsI18n: {
      'en-US': ['Research top AI writing tools and generate a comparison report', '@plan Build a full data pipeline: fetch, clean, analyze, and export', 'What is the current status of my running tasks?'],
      'zh-CN': ['调研主流 AI 写作工具并生成竞品对比报告', '@plan 构建完整数据流水线：拉取、清洗、分析、导出', '当前正在执行的任务进度是什么？'],
    },
  },
  {
    id: 'doctor',
    avatar: '🩺',
    presetAgentType: 'claude',
    resourceDir: 'assistant/doctor',
    ruleFiles: {
      'en-US': 'doctor.md',
      'zh-CN': 'doctor.md',
    },
    defaultEnabledSkills: ['browser'],
    defaultMode: 'yolo',
    opsEntryPoint: 'tests/e2e/run_op.py',
    modelConfigs: {
      overrides: [
        {
          match: {},
          modelConfig: {
            generateContentConfig: {
              temperature: 0.2,
              thinkingConfig: { thinkingBudget: 8192 },
            },
          },
        },
      ],
    },
    nameI18n: {
      'en-US': 'Doctor',
      'zh-CN': '诊断医生',
    },
    descriptionI18n: {
      'en-US': 'Self-diagnose this app by exploring its UI via browser automation. Deep-thinking, methodical testing with automated bug filing.',
      'zh-CN': '通过浏览器自动化探索自身 UI 进行自我诊断。深度思考、系统化测试，自动提交 bug。',
    },
    promptsI18n: {
      'en-US': ['Explore the app UI and look for any bugs', 'Test the security protection page toggles', 'Test creating a new conversation and sending a message'],
      'zh-CN': ['探索应用 UI，寻找 bug', '测试安全防护页面的开关功能', '测试新建会话并发送消息'],
    },
  },
  {
    id: 'ui-designer',
    avatar: '✨',
    presetAgentType: 'scode',
    resourceDir: 'assistant/ui-designer',
    ruleFiles: {
      'en-US': 'ui-designer.md',
      'zh-CN': 'ui-designer.md',
    },
    nameI18n: {
      'en-US': 'UI Designer Assistant',
      'zh-CN': 'UI设计师助手',
    },
    descriptionI18n: {
      'en-US': 'Professional UI/UX designer assistant providing design suggestions, visual reviews, component design, and translation to Tailwind CSS code.',
      'zh-CN': '专业的 UI/UX 设计师助手，提供界面设计建议、视觉评审、组件设计以及转换为 Tailwind CSS 代码。',
    },
    promptsI18n: {
      'en-US': ['Review this dashboard layout and suggest improvements', 'Design a high-converting pricing card', 'How do I implement a glassmorphism navbar in Tailwind CSS?'],
      'zh-CN': ['评审这个仪表板布局并提供改进建议', '设计一个高转化率的定价卡片', '如何使用 Tailwind CSS 实现玻璃拟物化的导航栏？'],
    },
  },
];
