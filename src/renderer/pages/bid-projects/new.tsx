import { Button, Form, Input, Message, Select, Steps, Tag } from '@arco-design/web-react';
import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageWrapper from '@renderer/components/base/PageWrapper';
import { createBidProject } from './storage';
import type { IBidProjectFileItem } from './types';

export default function BidProjectNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<IBidProjectFileItem[]>([]);
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form] = Form.useForm();

  const onSubmit = async () => {
    const values = await form.validate();
    setIsSubmitting(true);
    try {
      Message.info(t('bidProjects.new.startingAnalysisDesc'));
      const project = await createBidProject({
        name: values.name || '',
        company: values.company || '',
        budget: values.budget || '',
        projectType: values.projectType || '',
        target: values.target || '',
        duration: values.duration || '',
        procurementMethod: values.procurementMethod || '',
        remark: values.remark || '',
        files,
      });
      Message.success(t('bidProjects.projectCreated'));
      void navigate(`/app/bid-projects/${project.id}/analysis`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const onSelectFiles = (nextFiles: FileList | null) => {
    if (!nextFiles?.length) return;
    const list = Array.from(nextFiles).map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      name: file.name,
      path: window.electronAPI?.getPathForFile?.(file),
      size: file.size,
      type: file.type,
      origin: 'upload' as const,
    }));
    setFiles((current) => [...current, ...list]);
  };

  return (
    <PageWrapper title={t('bidProjects.newProjectTitle')} subtitle={t('bidProjects.newProjectSubtitle')} back={{ label: t('common.back'), onClick: () => void navigate('/app/bid-projects') }}>
      <div className='space-y-4'>
        <div className='card p-4'>
          <Steps current={step} type='arrow' size='small'>
            <Steps.Step title={t('bidProjects.new.steps.basicTitle')} description={t('bidProjects.new.steps.basicLabel')} />
            <Steps.Step title={t('bidProjects.new.steps.sourcesTitle')} description={t('bidProjects.new.steps.sourcesLabel')} />
            <Steps.Step title={t('bidProjects.new.steps.reviewTitle')} description={t('bidProjects.new.steps.reviewLabel')} />
          </Steps>
        </div>

        {step === 0 ? (
          <div className='card p-4'>
            <div className='text-15px font-medium text-foreground mb-4'>{t('bidProjects.basicInfo')}</div>
            <Form form={form} layout='vertical'>
              <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                <Form.Item label={t('bidProjects.fields.name')} field='name' rules={[{ required: true }]}>
                  <Input allowClear />
                </Form.Item>
                <Form.Item label={t('bidProjects.fields.company')} field='company'>
                  <Input allowClear />
                </Form.Item>
                <Form.Item label={t('bidProjects.fields.budget')} field='budget'>
                  <Input allowClear />
                </Form.Item>
                <Form.Item label={t('bidProjects.fields.projectType')} field='projectType'>
                  <Select allowClear placeholder={t('bidProjects.fields.projectType')}>
                    <Select.Option value='goods'>{t('bidProjects.new.options.projectType.goods')}</Select.Option>
                    <Select.Option value='service'>{t('bidProjects.new.options.projectType.service')}</Select.Option>
                    <Select.Option value='engineering'>{t('bidProjects.new.options.projectType.engineering')}</Select.Option>
                  </Select>
                </Form.Item>
                <Form.Item label={t('bidProjects.fields.target')} field='target'>
                  <Input allowClear />
                </Form.Item>
                <Form.Item label={t('bidProjects.fields.duration')} field='duration'>
                  <Input allowClear />
                </Form.Item>
                <Form.Item label={t('bidProjects.fields.procurementMethod')} field='procurementMethod'>
                  <Select allowClear placeholder={t('bidProjects.fields.procurementMethod')}>
                    <Select.Option value='direct'>{t('bidProjects.new.options.procurementMethod.direct')}</Select.Option>
                    <Select.Option value='public'>{t('bidProjects.new.options.procurementMethod.public')}</Select.Option>
                    <Select.Option value='consulting'>{t('bidProjects.new.options.procurementMethod.consulting')}</Select.Option>
                    <Select.Option value='negotiation'>{t('bidProjects.new.options.procurementMethod.negotiation')}</Select.Option>
                  </Select>
                </Form.Item>
              </div>
              <Form.Item label={t('bidProjects.fields.remark')} field='remark'>
                <Input.TextArea autoSize={{ minRows: 4, maxRows: 8 }} allowClear />
              </Form.Item>
            </Form>
            <div className='flex justify-end'>
              <Button type='primary' onClick={() => setStep(1)}>
                {t('bidProjects.new.nextUpload')}
              </Button>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className='grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4'>
            <div className='card p-4'>
              <div className='text-15px font-medium text-foreground mb-4'>{t('bidProjects.uploadTitle')}</div>
              <div className='rd-3 border border-dashed border-[var(--color-border-2)] p-4 bg-fill-1 text-center'>
                <div className='text-13px text-secondary mb-3'>{t('bidProjects.uploadDescription')}</div>
                <Button type='secondary' onClick={() => inputRef.current?.click()}>
                  {t('common.upload')}
                </Button>
                <input
                  ref={inputRef}
                  className='hidden'
                  multiple
                  type='file'
                  onChange={(event) => {
                    onSelectFiles(event.target.files);
                    event.target.value = '';
                  }}
                />
              </div>

              <div className='mt-4'>
                <div className='text-13px text-secondary mb-2'>{t('bidProjects.new.sourceInputs')}</div>
                <div className='flex flex-wrap gap-2'>
                  <Tag color='green'>{t('bidProjects.new.sourceOption.upload')}</Tag>
                  <Tag>{t('bidProjects.new.sourceOption.masterData')}</Tag>
                  <Tag>{t('bidProjects.new.sourceOption.procurementPlan')}</Tag>
                  <Tag>{t('bidProjects.new.sourceOption.historicalProject')}</Tag>
                </div>
              </div>
            </div>

            <div className='card p-4 h-fit'>
              <div className='text-15px font-medium text-foreground mb-4'>{t('bidProjects.new.currentMaterialPool')}</div>
              <div className='space-y-2'>
                {files.length === 0 ? (
                  <div className='text-13px text-secondary'>{t('bidProjects.noFiles')}</div>
                ) : (
                  files.map((file) => (
                    <div key={file.id} className='flex items-center justify-between gap-3 px-3 py-2 rd-2 bg-fill-1'>
                      <div className='min-w-0'>
                        <div className='truncate text-13px text-foreground'>{file.name}</div>
                        <div className='text-12px text-secondary'>{Math.max(1, Math.round(file.size / 1024))} KB</div>
                      </div>
                      <Button size='mini' type='text' onClick={() => setFiles((current) => current.filter((item) => item.id !== file.id))}>
                        {t('common.remove')}
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className='xl:col-span-2 flex justify-between'>
              <Button onClick={() => setStep(0)}>{t('common.back')}</Button>
              <Button type='primary' disabled={files.length === 0} onClick={() => setStep(2)}>
                {t('bidProjects.new.nextReview')}
              </Button>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className='grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4'>
            <div className='card p-4'>
              <div className='text-15px font-medium text-foreground mb-4'>{t('bidProjects.new.beforeStart')}</div>
              <div className='space-y-3 text-13px text-secondary'>
                <div>• {t('bidProjects.new.beforeStart.materialParsing')}</div>
                <div>• {t('bidProjects.new.beforeStart.factExtraction')}</div>
                <div>• {t('bidProjects.new.beforeStart.projectProfile')}</div>
                <div>• {t('bidProjects.new.beforeStart.templateRecommendation')}</div>
                <div>• {t('bidProjects.new.beforeStart.assetMatching')}</div>
              </div>
            </div>

            <div className='card p-4 h-fit'>
              <div className='text-15px font-medium text-foreground mb-4'>{t('bidProjects.new.assetUsedLater')}</div>
              <div className='flex flex-wrap gap-2'>
                <Tag>{t('bidProjects.new.assetOption.template')}</Tag>
                <Tag>{t('bidProjects.new.assetOption.clause')}</Tag>
                <Tag>{t('bidProjects.new.assetOption.industry')}</Tag>
                <Tag>{t('bidProjects.new.assetOption.reviewRule')}</Tag>
              </div>
            </div>

            <div className='xl:col-span-2 flex justify-between'>
              <Button onClick={() => setStep(1)}>{t('common.back')}</Button>
              <Button type='primary' loading={isSubmitting} onClick={() => void onSubmit()}>
                {isSubmitting ? t('bidProjects.new.startingAnalysis') : t('bidProjects.startAnalysis')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </PageWrapper>
  );
}
