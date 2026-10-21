import { expect, test } from '@playwright/test'

test('production public app proxies a real Moss consultation and contact submission', async ({
  page,
}) => {
  await page.goto('/consult')
  await expect(page.getByText('测试园区').first()).toBeVisible()
  await page.getByRole('button', { name: '有哪些算力支持？' }).click()
  await expect(page.getByText(/算力服务可申请，具体以园区审核为准/)).toBeVisible()
  await expect(page.getByText('算力政策.md', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: /联系园区/ }).click()
  await page.locator('input[name="email"]').fill('visitor@example.com')
  await page.locator('input[name="consent"]').check()
  await page.getByRole('button', { name: /提交联系意向/ }).click()
  await expect(page.getByText('联系意向已提交，园区工作人员可按所留方式与您联系。')).toBeVisible()
})

test('real contact CAPTCHA retries and sends a single SMS after verification', async ({ page, request }) => {
  const mossUrl = `http://127.0.0.1:${process.env.PARK_E2E_MOSS_PORT ?? '4174'}`
  const before = (await (await request.get(`${mossUrl}/__test__/sms-log`)).json()).length
  let sends = 0
  page.on('request', (req) => { if (req.url().endsWith('/contact-code')) sends++ })
  await page.goto('/consult')
  await page.getByRole('button', { name: /联系园区/ }).click()
  await page.locator('input[name="phone"]').fill('13812345678')
  await page.locator('#send-code').click()
  await expect(page.locator('#contact-challenge-answer')).toBeEnabled()
  await page.locator('#close-contact-challenge').click()
  await page.locator('#send-code').click()
  await expect(page.locator('#contact-challenge-answer')).toBeEnabled()
  const answer = (await (await request.get(`${mossUrl}/__test__/captcha-answer`)).json()).answer
  await page.locator('#contact-challenge-answer').fill(answer === 'ZZZZZ' ? 'AAAAA' : 'ZZZZZ')
  await page.locator('#contact-challenge-submit').click()
  await expect(page.locator('#contact-challenge-note')).toHaveText('验证失败，请重试。')
  await page.locator('#contact-challenge-retry').click()
  await expect(page.locator('#contact-challenge-answer')).toBeEnabled()
  const nextAnswer = (await (await request.get(`${mossUrl}/__test__/captcha-answer`)).json()).answer
  await page.locator('#contact-challenge-answer').fill(nextAnswer)
  await page.locator('#contact-challenge-submit').click()
  await expect(page.locator('#code-note')).toHaveText('短信验证码已成功发送，60 秒后可重新发送。')
  await expect(page.locator('#send-code')).toBeDisabled()
  expect(sends).toBe(1)
  const sms = await (await request.get(`${mossUrl}/__test__/sms-log`)).json()
  expect(sms.length).toBe(before + 1)
  expect(sms.at(-1).phone).toBe('13812345678')
})
