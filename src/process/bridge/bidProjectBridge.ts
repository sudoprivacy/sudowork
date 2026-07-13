import { ipcBridge } from '@/common';
import { bidProjectService } from '@process/services/bid-projects/BidProjectService';

export function initBidProjectBridge(): void {
  ipcBridge.bidProject.listProjects.provider(async () => {
    return { success: true, data: bidProjectService.listProjects() };
  });

  ipcBridge.bidProject.getProject.provider(async ({ projectId }) => {
    const detail = bidProjectService.getProject(projectId);
    if (!detail) {
      return { success: false, msg: 'Project not found' };
    }
    return { success: true, data: detail };
  });

  ipcBridge.bidProject.createProject.provider(async (input) => {
    const detail = await bidProjectService.createProject(input);
    return { success: true, data: detail };
  });

  ipcBridge.bidProject.updateProject.provider(async ({ projectId, updates }) => {
    const detail = bidProjectService.updateProject(projectId, updates);
    if (!detail) {
      return { success: false, msg: 'Project not found' };
    }
    return { success: true, data: detail };
  });

  ipcBridge.bidProject.parseAllSources.provider(async ({ projectId }) => {
    const detail = await bidProjectService.parseAllSources(projectId);
    if (!detail) {
      return { success: false, msg: 'Project not found' };
    }
    return { success: true, data: detail };
  });

  ipcBridge.bidProject.generateAiSections.provider(async (input) => {
    const detail = await bidProjectService.generateAiSections(input);
    if (!detail) {
      return { success: false, msg: 'Project not found' };
    }
    return { success: true, data: detail };
  });

  ipcBridge.bidProject.confirmFact.provider(async ({ factId }) => {
    const fact = bidProjectService.confirmFact(factId);
    if (!fact) {
      return { success: false, msg: 'Fact not found' };
    }
    return { success: true, data: fact };
  });

  ipcBridge.bidProject.rejectFact.provider(async ({ factId }) => {
    const fact = bidProjectService.rejectFact(factId);
    if (!fact) {
      return { success: false, msg: 'Fact not found' };
    }
    return { success: true, data: fact };
  });
}
