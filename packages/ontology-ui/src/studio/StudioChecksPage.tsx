import { useState } from 'react';
import { Alert, Button, Empty, Select, Space, Table, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ontologyBlockingIssues } from '@sudowork/ontology-common';
import type { IOntologyConsistencyCheckResult, IOntologyConsistencyIssue, IOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyStudioApi } from './api';
import styles from './studio.module.css';

export default function StudioChecksPage({ snapshot, api, report, isModelDirty, isRepairing, onReport, onRepair, onError, onLocate, onRelease }: IStudioChecksPageProps) {
  const { t } = useTranslation();
  const text = (key: string) => t(`ontology.studio.${key}`);
  const [isChecking, setIsChecking] = useState(false);
  const [severity, setSeverity] = useState('all');
  const onCheck = async () => {
    setIsChecking(true);
    try {
      onReport(await api.runConsistencyCheck({ workspaceId: snapshot.workspaceId }));
    } catch (error) {
      onError(error);
    } finally {
      setIsChecking(false);
    }
  };
  const isStale = !!report && report.revision !== (snapshot.revision || 0);
  const errors = report ? ontologyBlockingIssues(report) : [];
  const warnings = report?.issues.filter((issue) => issue.severity === 'warning') || [];
  const issues = [...errors, ...warnings].filter((issue) => severity === 'all' || issue.severity === severity);
  const isRepairDisabled = isStale || isModelDirty || isChecking || isRepairing;
  const targetName = (issue: IOntologyConsistencyIssue) => [...snapshot.objects, ...snapshot.relations, ...snapshot.logicFunctions, ...snapshot.actions, ...snapshot.qualityRules].find((item) => item.id === issue.targetId)?.name;
  return (
    <section className={styles['ontology-page']}>
      <div className={styles['ontology-page-heading']}>
        <div>
          <Typography.Title heading={5}>{text('checksTitle')}</Typography.Title>
          <Typography.Text type='secondary'>{text('checksDescription')}</Typography.Text>
        </div>
        <Button type='primary' loading={isChecking} disabled={isModelDirty} onClick={() => void onCheck()}>
          {text('runChecks')}
        </Button>
      </div>
      {isModelDirty && <Alert type='warning' content={text('saveBeforeChecks')} style={{ marginBottom: 16 }} />}
      {snapshot.semanticDocument?.imports.length ? (
        <Alert
          type='info'
          content={
            <>
              {text('importsUnresolved')}
              <ul>
                {snapshot.semanticDocument.imports.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {report ? (
        <>
          <Alert
            type={isStale || (!errors.length && warnings.length) ? 'warning' : errors.length ? 'error' : 'success'}
            title={isStale ? text('staleReport') : t(`ontology.studio.${errors.length ? 'blockingSummary' : warnings.length ? 'warningSummary' : 'checksPassed'}`, { errors: errors.length, warnings: warnings.length })}
            content={text(errors.length ? 'blockingExplanation' : 'warningsDoNotBlock')}
          />
          <Space wrap style={{ margin: '16px 0' }}>
            <Select
              aria-label={text('issueFilter')}
              value={severity}
              onChange={setSeverity}
              style={{ width: 190 }}
              options={[
                { label: t('ontology.studio.allIssues', { count: report.issues.length }), value: 'all' },
                { label: t('ontology.studio.errorIssues', { count: errors.length }), value: 'error' },
                { label: t('ontology.studio.warningIssues', { count: warnings.length }), value: 'warning' },
              ]}
            />
            {!!report.issues.length && (
              <Button loading={isRepairing} disabled={isRepairDisabled} onClick={() => onRepair(errors.length ? errors : warnings)}>
                {text(errors.length ? 'repairBlocking' : 'repairWarnings')}
              </Button>
            )}
            {!errors.length && (
              <Button type='primary' disabled={isStale || isModelDirty || isChecking} onClick={onRelease}>
                {text('goCreateCandidate')}
              </Button>
            )}
          </Space>
          <Table
            rowKey='id'
            data={issues}
            noDataElement={<Empty description={text('noIssues')} />}
            columns={[
              { title: text('severity'), width: 130, render: (_value, issue) => <Tag color={issue.severity === 'error' ? 'red' : 'orange'}>{text(issue.severity === 'error' ? 'blockingError' : 'advisoryWarning')}</Tag> },
              { title: text('checkTarget'), width: 180, render: (_value, issue) => targetName(issue) || text('currentOntology') },
              { title: text('description'), render: (_value, issue) => (issue.code === 'semantic_only_relation' ? t('ontology.studio.semanticOnlyExplanation', { name: targetName(issue) }) : issue.code ? t(`ontology.studio.issues.${issue.code}`, { defaultValue: issue.message }) : issue.message) },
              {
                title: text('operations'),
                width: 200,
                render: (_value, issue) => (
                  <Space wrap>
                    <Button type='text' size='small' disabled={isRepairDisabled} onClick={() => onRepair([issue])}>
                      {text('aiRepair')}
                    </Button>
                    <Button type='text' size='small' onClick={() => onLocate(issue)}>
                      {text('locate')}
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
          {!!report.qualityRuleResults?.length && (
            <>
              <Typography.Title heading={6}>{t('ontology.qualityRuleRun.title')}</Typography.Title>
              <Table
                rowKey='ruleId'
                data={report.qualityRuleResults}
                columns={[
                  { title: text('name'), dataIndex: 'ruleName' },
                  { title: text('severity'), render: (_value, rule) => t(`ontology.ruleSeverity.${rule.severity}`) },
                  { title: text('status'), render: (_value, rule) => <Tag color={rule.status === 'passed' ? 'green' : rule.status === 'skipped' ? undefined : rule.severity === 'error' ? 'red' : 'orange'}>{t(`ontology.qualityRuleRun.status.${rule.status}`)}</Tag> },
                  { title: text('checkedRows'), dataIndex: 'evaluatedRows' },
                  { title: text('failedRows'), dataIndex: 'failedRows' },
                  { title: text('description'), render: (_value, rule) => (rule.reason ? t(`ontology.qualityRuleRun.reason.${rule.reason}`) : rule.isTruncated ? text('sampledCheck') : text('unknownValue')) },
                ]}
              />
            </>
          )}
        </>
      ) : (
        <Empty description={text('noChecks')} />
      )}
    </section>
  );
}

interface IStudioChecksPageProps {
  snapshot: IOntologyWorkbenchSnapshot;
  api: IOntologyStudioApi;
  report?: IOntologyConsistencyCheckResult;
  isModelDirty: boolean;
  isRepairing: boolean;
  onReport: (report: IOntologyConsistencyCheckResult) => void;
  onRepair: (issues: IOntologyConsistencyIssue[]) => void;
  onLocate: (issue: IOntologyConsistencyIssue) => void;
  onRelease: () => void;
  onError: (error: unknown) => void;
}
