/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Badge } from '@arco-design/web-react';
import { IconCheckCircle, IconDown, IconRight } from '@arco-design/web-react/icon';
import React, { useState } from 'react';
import type { IMessagePlan } from '../../common/chatLib';

const MessagePlan: React.FC<{ message: IMessagePlan }> = ({ message }) => {
  const [showMore, setShowMore] = useState(false);
  return (
    <div>
      <div className='flex cursor-pointer items-center gap-2.5 text-foreground-tertiary' onClick={() => setShowMore(!showMore)}>
        <Badge status='default' text='To do list' className='![&_span.arco-badge-status-text]:text-foreground-tertiary'></Badge>
        {showMore ? <IconDown /> : <IconRight />}
      </div>
      {showMore && (
        <div className='flex flex-col gap-2 pl-5 pt-2'>
          {message.content.entries.map((item) => {
            return (
              <div className='flex flex-row items-center gap-2 text-foreground-tertiary'>
                {item.status === 'completed' ? (
                  <IconCheckCircle fontSize={22} strokeWidth={4} className='flex text-success' />
                ) : (
                  <div className='size-22px flex items-center justify-center'>
                    <div className='h-3.5 w-3.5 rounded-full border-2 border-deep'></div>
                  </div>
                )}
                <span>{item.content} </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MessagePlan;
