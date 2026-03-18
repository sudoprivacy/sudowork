import { dynamicNexusService } from './services/nexus/DynamicNexusService';

/**
 * 启动 Nexus 服务的函数，使用动态下载方式
 */
export const startNexusService = async (): Promise<void> => {
  try {
    // 检查是否已安装
    const isInstalled = await dynamicNexusService.checkInstalled();

    if (isInstalled) {
      // 如果已安装，则启动服务
      await dynamicNexusService.start();
    } else {
      // 如果未安装，记录一条消息，但不中断应用启动
      console.log('[Process] Nexus not installed yet. It can be installed from the settings.');
    }
  } catch (error) {
    console.error('[Process] Failed to start Nexus server:', error);
    // Don't fail app startup if Nexus server fails to start
  }
};
