/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Avatar } from '@arco-design/web-react';
import { User } from '@icon-park/react';
import { useUserAvatar } from '../hooks/useUserAvatar';
import AvatarSelectorModal from './AvatarSelectorModal';

const ConsumerAvatar: React.FC = () => {
  const { avatarSrc } = useUserAvatar();
  const [modalVisible, setModalVisible] = useState(false);

  return (
    <>
      <Avatar size={64} className='bg-primary/10 cursor-pointer hover:opacity-80 transition-opacity' onClick={() => setModalVisible(true)}>
        {avatarSrc ? <img src={avatarSrc} width={64} height={64} style={{ objectFit: 'cover', borderRadius: '50%' }} alt='' /> : <User theme='outline' size={32} className='text-primary' />}
      </Avatar>
      <AvatarSelectorModal visible={modalVisible} onClose={() => setModalVisible(false)} />
    </>
  );
};

export default ConsumerAvatar;
