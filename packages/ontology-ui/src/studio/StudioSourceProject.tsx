import type { ReactNode } from "react";
import { Button, Space, Tag, Typography } from "@arco-design/web-react";
import { useTranslation } from "react-i18next";
import type { IOntologyStudioProject } from "@sudowork/ontology-common";
import styles from "./studio.module.css";
import type { IStudioChatContext, IStudioChatOptions } from "./OntologyStudio";

/** A canonical project uses the existing chat, never the legacy RDF editor. */
export default function StudioSourceProject({
  project,
  renderChat,
  onBack,
  onRefresh,
}: IStudioSourceProjectProps) {
  const { t } = useTranslation();
  const text = (key: string) => t(`ontology.studio.${key}`);
  const source = project.source;
  return (
    <div className={styles["ontology-source-project"]}>
      <div className={styles["ontology-page-heading"]}>
        <Space>
          <Button onClick={onBack}>{text("library")}</Button>
          <Typography.Title heading={4}>{project.name}</Typography.Title>
        </Space>
        <Button onClick={() => void onRefresh()}>
          {text("sourceRefresh")}
        </Button>
      </div>
      <details className={styles["ontology-source-status"]}>
        <summary>
          <span>{text("sourceOverview")}</span>
          {source ? (
            <>
              <Tag color={source.structureComplete ? "green" : "orange"}>
                {text(
                  source.structureComplete
                    ? "sourceStructureComplete"
                    : "sourceStructureIncomplete",
                )}
              </Tag>
              <span className={styles["ontology-source-counts"]}>
                {t("ontology.studio.sourceCounts", {
                  tables: source.tables,
                  views: source.databaseViews,
                  fields: source.fields,
                })}
              </span>
            </>
          ) : (
            <Tag>{text("sourceReceiptMissing")}</Tag>
          )}
        </summary>
        {source && (
          <>
            <div className={styles["ontology-source-receipt"]}>
              <Tag>
                {text(
                  source.delivery === "live"
                    ? "sourceLiveRecords"
                    : source.delivery === "snapshot"
                      ? "sourceSnapshotRecords"
                      : "sourceRecordsUnavailable",
                )}
              </Tag>
              <p>
                {text("sourceRevision")}: <code>{source.revision}</code>
              </p>
              <p>
                {text("sourceObservation")}:{" "}
                {source.observedAt || text("sourceObservationUnknown")}
              </p>
              <Typography.Text type="secondary">
                {text("sourceObservationHint")}
              </Typography.Text>
            </div>
          </>
        )}
      </details>
      <div className={styles["ontology-chat-pane"]}>
        {renderChat(project.workspaceId, project.name, undefined, undefined, {
          modelAuthority: "sudograph",
        })}
      </div>
    </div>
  );
}

interface IStudioSourceProjectProps {
  project: IOntologyStudioProject;
  renderChat: (
    workspaceId: string,
    name: string,
    context?: IStudioChatContext,
    requestedConversationId?: string,
    options?: IStudioChatOptions,
  ) => ReactNode;
  onBack: () => void;
  onRefresh: () => Promise<void>;
}
