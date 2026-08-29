import React from 'react'

/** Task 4 阶段的路由占位页；Task 5-8 逐个替换为真实页面。 */
export function PlaceholderPage({
  title,
  feature,
}: {
  title: string
  feature: string
}): React.ReactElement {
  return (
    <div className='size-full f-center flex-col gap-2 text-secondary' data-testid='placeholder-page'>
      <div className='text-20px font-600 text-foreground'>{title}</div>
      <div className='text-13px'>待实现（{feature}）</div>
    </div>
  )
}
