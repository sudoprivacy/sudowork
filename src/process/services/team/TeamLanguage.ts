export type TeamUserLanguage = 'zh' | 'en';

const HAN_SCRIPT_PATTERN = /[㐀-鿿]/;

export function detectTeamUserLanguage(text: string): TeamUserLanguage {
  return HAN_SCRIPT_PATTERN.test(text) ? 'zh' : 'en';
}

export function buildTeamUserLanguageContract(language: TeamUserLanguage): string {
  if (language === 'zh') {
    return (
      `[Team User Language Contract]\n` +
      `最近一条真实用户消息的主要语言是中文。所有面向用户的自然语言回复都必须使用中文，包括工具调用前后状态说明、进度说明、中间总结和最终总结。` +
      `除代码、命令、路径、工具名、模型名、专有名词或引用原文外，不要输出完整英文句子。` +
      `本约定只约束面向用户的自然语言回复语言，不改变工具选择，不改变工具参数，不改变工具选择、工具参数、任务拆分、团队协作或执行逻辑。`
    );
  }

  return (
    `[Team User Language Contract]\n` +
    `The latest real user message is primarily English. All user-facing natural-language replies must be in English, including tool-call status, progress updates, intermediate summaries, and final answers. ` +
    `Code, commands, paths, tool names, model names, proper nouns, and quoted source text may stay as-is. ` +
    `This contract only controls the language of user-facing natural-language replies; it does not change tool choices, tool arguments, task decomposition, team coordination, or execution logic.`
  );
}
