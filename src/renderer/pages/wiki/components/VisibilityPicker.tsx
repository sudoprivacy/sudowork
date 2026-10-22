/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Radio, Select, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { OrgDirectory } from '../api/types';
import type { IVisibilityValue, VisibilityMode } from '../utils/visibility';
import { filterOptionByText } from '../utils/files';

const MODES: VisibilityMode[] = ['self', 'departments', 'users', 'all'];

/** Who may use a private wiki: only me / departments / users / everyone. The owner is always included. */
export default function VisibilityPicker({ value, directory, ownerId, onChange }: IVisibilityPickerProps) {
  const { t } = useTranslation();

  return (
    <div className='flex flex-col gap-8px'>
      <Radio.Group type='button' value={value.mode} onChange={(mode: VisibilityMode) => onChange({ ...value, mode })}>
        {MODES.map((mode) => (
          <Radio key={mode} value={mode}>
            {t(`wiki.visibility.${mode}`)}
          </Radio>
        ))}
      </Radio.Group>
      {value.mode === 'departments' && (
        <Select mode='multiple' allowClear showSearch placeholder={t('wiki.visibility.pickDepartments')} value={value.departmentIds} onChange={(ids: string[]) => onChange({ ...value, departmentIds: ids })} filterOption={filterOptionByText}>
          {(directory?.departments ?? []).map((d) => (
            <Select.Option key={d.id} value={d.id}>
              {d.name}
            </Select.Option>
          ))}
        </Select>
      )}
      {value.mode === 'users' && (
        <Select mode='multiple' allowClear showSearch placeholder={t('wiki.visibility.pickUsers')} value={value.userIds} onChange={(ids: string[]) => onChange({ ...value, userIds: ids })} filterOption={filterOptionByText}>
          {(directory?.users ?? [])
            .filter((u) => u.id !== ownerId)
            .map((u) => (
              <Select.Option key={u.id} value={u.id}>
                {u.displayName || u.name}
              </Select.Option>
            ))}
        </Select>
      )}
      <Typography.Text type='secondary' className='text-12px'>
        {t('wiki.visibility.hint')}
      </Typography.Text>
    </div>
  );
}

interface IVisibilityPickerProps {
  value: IVisibilityValue;
  directory: OrgDirectory | null;
  ownerId: string;
  onChange: (value: IVisibilityValue) => void;
}
