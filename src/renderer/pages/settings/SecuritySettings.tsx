import { Shield, CheckOne, Lock, Scan } from '@icon-park/react';
import { Card, Switch, Tag } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

const SecuritySettings: React.FC = () => {
  const { t } = useTranslation();

  // 安全功能状态
  const [envProtection, setEnvProtection] = useState(true);
  const [infoProtection, setInfoProtection] = useState(true);
  const [skillScan, setSkillScan] = useState(true);

  return (
    <div className='p-24px flex flex-col gap-24px'>
      {/* 页面标题 */}
      <div className='flex flex-col gap-8px'>
        <h2 className='text-24px font-600 text-t-primary'>安全防护</h2>
        <p className='text-14px text-t-secondary'>全方位保护您的系统和数据安全</p>
      </div>

      {/* 电脑环境安全防护 */}
      <Card className='rd-12px hover:shadow-md transition-shadow'>
        <div className='flex items-start gap-16px'>
          <div className='w-56px h-56px rounded-12px bg-[#faad1415] flex items-center justify-center flex-shrink-0'>
            <Shield theme='outline' size='32' fill='#faad14' />
          </div>
          <div className='flex-1'>
            <div className='flex items-center gap-8px mb-8px'>
              <h3 className='text-18px font-600 text-t-primary'>电脑环境安全防护</h3>
              <Tag color='orange' size='small' className='rd-4px'>
                <CheckOne theme='filled' size='12' className='mr-4px' />
                主动防御
              </Tag>
            </div>
            <p className='text-14px text-t-secondary mb-16px leading-relaxed'>当智能体调用各类工具时，系统会进行全过程的安全管控。识别并拦截可能破坏系统、窃取数据、尝试提权的高风险行为，保障您的电脑环境安全。</p>
            <div className='flex items-center justify-end gap-12px'>
              <Tag color='green' size='small' className='rd-12px px-12px'>
                <span className='w-6px h-6px rd-50% bg-[#52c41a] inline-block mr-6px'></span>
                保护中
              </Tag>
              <Switch checked={envProtection} onChange={setEnvProtection} />
            </div>
          </div>
        </div>
      </Card>

      {/* 用户信息安全保护 */}
      <Card className='rd-12px hover:shadow-md transition-shadow'>
        <div className='flex items-start gap-16px'>
          <div className='w-56px h-56px rounded-12px bg-[#52c41a15] flex items-center justify-center flex-shrink-0'>
            <Lock theme='outline' size='32' fill='#52c41a' />
          </div>
          <div className='flex-1'>
            <div className='flex items-center gap-8px mb-8px'>
              <h3 className='text-18px font-600 text-t-primary'>用户信息安全保护</h3>
              <Tag color='green' size='small' className='rd-4px'>
                <CheckOne theme='filled' size='12' className='mr-4px' />
                智能识别
              </Tag>
            </div>
            <p className='text-14px text-t-secondary mb-16px leading-relaxed'>对输入给智能体的任务、提示词进行智能安全识别，自动检测是否包含个人隐私、敏感密钥、账号凭证等高风险信息，保障用户信息安全。</p>
            <div className='flex items-center justify-end gap-12px'>
              <Tag color='green' size='small' className='rd-12px px-12px'>
                <span className='w-6px h-6px rd-50% bg-[#52c41a] inline-block mr-6px'></span>
                保护中
              </Tag>
              <Switch checked={infoProtection} onChange={setInfoProtection} />
            </div>
          </div>
        </div>
      </Card>

      {/* Skill 技能安全扫描 */}
      <Card className='rd-12px hover:shadow-md transition-shadow'>
        <div className='flex items-start gap-16px'>
          <div className='w-56px h-56px rounded-12px bg-[#1890ff15] flex items-center justify-center flex-shrink-0'>
            <Scan theme='outline' size='32' fill='#1890ff' />
          </div>
          <div className='flex-1'>
            <div className='flex items-center gap-8px mb-8px'>
              <h3 className='text-18px font-600 text-t-primary'>Skill 技能安全扫描</h3>
              <Tag color='blue' size='small' className='rd-4px'>
                <CheckOne theme='filled' size='12' className='mr-4px' />
                多层检测
              </Tag>
            </div>
            <p className='text-14px text-t-secondary mb-16px leading-relaxed'>所有 Skill 在安装和接入前，系统都会进行多层安全检测，包括来源可信度、代码审查、权限评估等，确保所有接入的技能纯净无害。</p>
            <div className='flex items-center justify-end gap-12px'>
              <Tag color='green' size='small' className='rd-12px px-12px'>
                <span className='w-6px h-6px rd-50% bg-[#52c41a] inline-block mr-6px'></span>
                保护中
              </Tag>
              <Switch checked={skillScan} onChange={setSkillScan} />
            </div>
          </div>
        </div>
      </Card>

      {/* 底部提示 */}
      <div className='flex items-center justify-center gap-8px text-14px text-t-tertiary mt-16px'>
        <Shield theme='outline' size='16' fill='currentColor' />
        <span>您的每一次操作都在系统严格保护之下</span>
      </div>
    </div>
  );
};

export default SecuritySettings;
