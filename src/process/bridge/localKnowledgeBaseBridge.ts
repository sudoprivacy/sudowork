import { ipcBridge } from '@/common';
import { localKnowledgeBaseService } from '@process/services/local-kb/LocalKnowledgeBaseService';
import { mainError } from '@process/utils/mainLogger';

function ok<T>(data: T) {
  return { success: true, data };
}

function fail(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { success: false, msg };
}

export function initLocalKnowledgeBaseBridge(): void {
  ipcBridge.localKnowledgeBase.listCategories.provider(async () => {
    try {
      return ok(localKnowledgeBaseService.listCategories());
    } catch (err) {
      mainError('LocalKbBridge', 'listCategories failed:', err);
      return fail(err);
    }
  });

  ipcBridge.localKnowledgeBase.createCategory.provider(async (input) => {
    try {
      return ok(localKnowledgeBaseService.createCategory(input));
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.localKnowledgeBase.updateCategory.provider(async ({ id, updates }) => {
    try {
      return ok(localKnowledgeBaseService.updateCategory(id, updates));
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.localKnowledgeBase.deleteCategory.provider(async ({ id }) => {
    try {
      localKnowledgeBaseService.deleteCategory(id);
      return ok(undefined);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.localKnowledgeBase.listSpaces.provider(async (input) => {
    try {
      return ok(localKnowledgeBaseService.listSpaces(input?.categoryId));
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.localKnowledgeBase.createSpace.provider(async (input) => {
    try {
      return ok(localKnowledgeBaseService.createSpace(input));
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.localKnowledgeBase.updateSpace.provider(async ({ id, updates }) => {
    try {
      return ok(localKnowledgeBaseService.updateSpace(id, updates));
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.localKnowledgeBase.deleteSpace.provider(async ({ id }) => {
    try {
      await localKnowledgeBaseService.deleteSpace(id);
      return ok(undefined);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.localKnowledgeBase.listDocuments.provider(async ({ spaceId }) => {
    try {
      return ok(localKnowledgeBaseService.listDocuments(spaceId));
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.localKnowledgeBase.addFiles.provider(async (input) => {
    try {
      return ok(await localKnowledgeBaseService.addFiles(input));
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.localKnowledgeBase.setDirectory.provider(async (input) => {
    try {
      return ok(await localKnowledgeBaseService.setDirectory(input));
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.localKnowledgeBase.queueBuild.provider(async ({ spaceId }) => {
    try {
      return ok(localKnowledgeBaseService.queueBuild(spaceId));
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.localKnowledgeBase.getBuildStatus.provider(async ({ spaceId }) => {
    try {
      return ok(localKnowledgeBaseService.getBuildStatus(spaceId));
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.localKnowledgeBase.listBuildJobs.provider(async ({ spaceId, limit }) => {
    try {
      return ok(localKnowledgeBaseService.listBuildJobs(spaceId, limit));
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.localKnowledgeBase.search.provider(async ({ spaceId, query }) => {
    try {
      return ok(await localKnowledgeBaseService.search(spaceId, query));
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.localKnowledgeBase.searchMany.provider(async ({ spaceIds, query }) => {
    try {
      return ok(await localKnowledgeBaseService.searchMany(spaceIds, query));
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.localKnowledgeBase.getDependencyStatus.provider(async () => {
    try {
      return ok(await localKnowledgeBaseService.getDependencyStatus());
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.localKnowledgeBase.installEmbeddingModel.provider(async (input) => {
    try {
      await localKnowledgeBaseService.installEmbeddingModel(
        (phase, percent) => {
          ipcBridge.localKnowledgeBase.installEmbeddingModelProgress.emit({ phase, percent });
        },
        { downloadUrl: input?.downloadUrl }
      );
      ipcBridge.localKnowledgeBase.installEmbeddingModelResult.emit({ success: true });
      return ok(undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ipcBridge.localKnowledgeBase.installEmbeddingModelResult.emit({ success: false, msg });
      return { success: false, msg };
    }
  });
}
