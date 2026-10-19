import { expect, test } from '@playwright/test'

test('production public app proxies a real Moss consultation and contact submission', async ({
  page,
}) => {
  await page.goto('/consult')
  await expect(page.getByText('测试园区').first()).toBeVisible()
  await page.getByRole('button', { name: '有哪些算力支持？' }).click()
  await expect(page.getByText(/算力服务可申请，具体以园区审核为准/)).toBeVisible()
  await expect(page.getByText('算力政策', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: /联系园区/ }).click()
  await page.locator('input[name="email"]').fill('visitor@example.com')
  await page.locator('input[name="consent"]').check()
  await page.getByRole('button', { name: /提交联系意向/ }).click()
  await expect(page.getByText('联系意向已提交，园区工作人员可按所留方式与您联系。')).toBeVisible()
})
