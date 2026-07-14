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
    console.log('[bid-projects] bridge createProject called', { name: input.name, company: input.company, fileCount: input.files.length });
    const detail = await bidProjectService.createProject(input);
    console.log('[bid-projects] bridge createProject success', { id: detail.project.id, status: detail.project.status });
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

  ipcBridge.bidProject.chatAssistant.provider(async (input) => {
    const result = await bidProjectService.chatWithAssistant(input);
    if (!result) {
      return { success: false, msg: 'Project not found' };
    }
    return { success: true, data: result };
  });
}
