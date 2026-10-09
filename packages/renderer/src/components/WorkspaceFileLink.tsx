import React from 'react';
import { usePreviewLauncher } from '@renderer/hooks/usePreviewLauncher';
import { getContentTypeByExtension } from '@renderer/pages/conversation/preview/utils/fileUtils';
import type { ConversationContextValue } from '@renderer/context/ConversationContext';

/** Open session links through the same preview launcher used by deliverables. */
export default function WorkspaceFileLink({ conversation, file, ...props }: IWorkspaceFileLinkProps) {
  const { launchPreview } = usePreviewLauncher();
  const onClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const isRemote = conversation.type === 'remote-agent';
    void launchPreview({
      originalPath: isRemote ? undefined : file.path,
      relativePath: isRemote ? file.relativePath || file.path : file.relativePath,
      remoteConversationId: isRemote ? conversation.conversationId : undefined,
      fileName: file.path.split('/').pop(),
      contentType: getContentTypeByExtension(file.path),
      editable: false,
    });
  };
  return <a {...props} onClick={onClick} />;
}

interface IWorkspaceFileLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  conversation: ConversationContextValue;
  file: { path: string; relativePath?: string };
}
