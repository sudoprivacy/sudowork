import { zh as t } from './locale'
import './style.css'
import { DEFAULT_PARK_LOGO, parkLogoUrl, setParkFavicon } from '../brand'
import { renderMarkdown, disposeMarkdown } from './MarkdownBody'
import { renderSources, type SourceRef } from './sources'

interface PublicContext {
  display_name: string
  logo_url: string | null
  welcome_text: string
  contact_enabled: boolean
  published_policy_version: string | null
  consent_text: string
}

interface QuickQuestion {
  id: string
  question: string
  sort_order: number
}

interface SessionStatus {
  closing_at: number | null
  closed: boolean
}

class PublicApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfter: number = 0,
  ) {
    super(code)
  }
}

const root = document.getElementById('app')!
root.innerHTML = `
  <div class="consult-page">
    <header class="page-header">
      <div class="consult-brand"><img class="brand-logo" id="brand-mark" src="${DEFAULT_PARK_LOGO}" alt=""><img class="brand-logo" id="brand-logo" alt="" hidden><span><strong id="park-name"></strong></span></div>
      <button class="header-contact" type="button" id="open-contact">${t.contactPark} <span aria-hidden="true">↗</span></button>
    </header>
    <main class="consult-main-new">
      <section class="chat-card" aria-label="${t.assistant}">
        <div class="chat-heading"><div class="assistant-heading"><strong>${t.assistant}</strong><span>${t.assistantBasis}</span></div><span class="chat-ready"><span class="status-dot" aria-hidden="true"></span>${t.ready}</span></div>
        <div class="question-area"><div class="question-caption"><strong>${t.quickQuestions}</strong><span>${t.quickHint}</span></div><div class="question-chips" id="question-chips"></div></div>
        <div class="session-reminder" id="session-reminder" role="status" hidden></div>
        <div class="chat-log" id="chat-log" role="log" aria-live="polite"><div class="conversation-start" id="start-hint">${t.loading}</div></div>
        <form class="question-composer" id="question-form"><label class="sr-only" for="question-input">${t.inputLabel}</label><textarea id="question-input" rows="2" placeholder="${t.inputPlaceholder}"></textarea><div class="composer-actions"><button type="submit" disabled>${t.send} <span aria-hidden="true">→</span></button></div></form>
        <p class="chat-disclaimer">${t.disclaimer}</p>
      </section>
      <section class="captcha-panel" id="challenge-panel" hidden><div><strong>${t.challengeTitle}</strong><p>${t.challengeHint}</p></div><img id="challenge-image" alt="${t.challengeAnswer}"><form id="challenge-form"><label class="sr-only" for="challenge-answer">${t.challengeAnswer}</label><input id="challenge-answer" maxlength="5" placeholder="${t.challengeAnswer}"><button type="submit">${t.challengeSubmit}</button></form><small id="challenge-note"></small></section>
      <section class="contact-form-section" id="contact-section" hidden aria-labelledby="contact-title"><div class="form-heading"><div><h2 id="contact-title">${t.contactTitle}</h2><p>${t.contactDescription}</p></div><button class="form-close" type="button" id="close-contact" aria-label="${t.close}">×</button></div>
        <form id="contact-form">
          <p class="contact-guidance" id="contact-guidance">${t.consultFirstHint}</p>
          <div class="fields">
            <label>${t.name} <small>${t.optional}</small><input name="name" autocomplete="name" placeholder="${t.namePlaceholder}"></label>
            <label>${t.company} <small>${t.optional}</small><input name="company" autocomplete="organization" placeholder="${t.companyPlaceholder}"></label>
            <label>${t.phone} <small>${t.phoneAlternative}</small><input name="phone" type="tel" autocomplete="tel" placeholder="${t.phonePlaceholder}"></label>
            <label>${t.email} <small>${t.emailAlternative}</small><input name="email" type="email" autocomplete="email" placeholder="${t.emailPlaceholder}"></label>
          </div>
          <p class="contact-requirement">${t.contactRequirement}</p>
          <div class="phone-verification" id="phone-verification" hidden><strong>${t.phoneVerification}</strong><div class="otp-row"><input id="phone-code" inputmode="numeric" maxlength="6" aria-label="${t.phoneVerification}" placeholder="${t.codePlaceholder}"><button type="button" id="send-code" disabled>${t.sendCode}</button></div><small id="code-note"></small></div>
          <label class="consent"><input name="consent" type="checkbox" required><span>${t.consent} <button class="consent-link" id="show-consent" type="button" hidden>${t.viewConsent}</button></span></label>
          <div class="form-actions"><button class="submit-contact" type="submit" disabled>${t.submitContact} →</button><span id="contact-note">${t.contactHint}</span></div>
        </form>
      </section>
    </main>
    <footer class="consult-footer-new"><span id="footer-park"></span><span>${t.disclaimer}</span></footer>
    <dialog class="consent-dialog" id="consent-dialog"><div><div class="consent-dialog-heading"><strong>${t.consentTitle}</strong><button type="button" id="close-consent" aria-label="${t.close}">×</button></div><p id="consent-full-text"></p></div></dialog>
    <dialog class="consent-dialog contact-challenge" id="contact-challenge"><div><div class="consent-dialog-heading"><strong>${t.challengeTitle}</strong><button type="button" id="close-contact-challenge" aria-label="${t.close}">×</button></div><p>${t.smsChallengeHint}</p><img id="contact-challenge-image" alt="${t.challengeAnswer}"><div class="otp-row"><input id="contact-challenge-answer" maxlength="5" placeholder="${t.challengeAnswer}"><button type="button" id="contact-challenge-submit">${t.challengeSubmit}</button></div><small id="contact-challenge-note" role="status"></small><button type="button" id="contact-challenge-retry" hidden>${t.challengeRetry}</button></div></dialog>
  </div>`

const parkName = document.getElementById('park-name')!
const brandMark = document.getElementById('brand-mark')!
const brandLogo = document.getElementById('brand-logo') as HTMLImageElement
const footerPark = document.getElementById('footer-park')!
const startHint = document.getElementById('start-hint')!
const chips = document.getElementById('question-chips')!
const log = document.getElementById('chat-log')!
const questionInput = document.getElementById('question-input') as HTMLTextAreaElement
const questionForm = document.getElementById('question-form') as HTMLFormElement
const sendButton = questionForm.querySelector('button[type="submit"]') as HTMLButtonElement
const sessionReminder = document.getElementById('session-reminder')!
const contactSection = document.getElementById('contact-section')!
const contactForm = document.getElementById('contact-form') as HTMLFormElement
const contactGuidance = document.getElementById('contact-guidance')!
const contactNote = document.getElementById('contact-note')!
const phoneInput = contactForm.elements.namedItem('phone') as HTMLInputElement
const emailInput = contactForm.elements.namedItem('email') as HTMLInputElement
const phoneCode = document.getElementById('phone-code') as HTMLInputElement
const phoneVerification = document.getElementById('phone-verification')!
const sendCodeButton = document.getElementById('send-code') as HTMLButtonElement
const submitContactButton = contactForm.querySelector('.submit-contact') as HTMLButtonElement
const codeNote = document.getElementById('code-note')!
const challengePanel = document.getElementById('challenge-panel')!
const challengeImage = document.getElementById('challenge-image') as HTMLImageElement
const challengeForm = document.getElementById('challenge-form') as HTMLFormElement
const challengeNote = document.getElementById('challenge-note')!
const contactChallenge = document.getElementById('contact-challenge') as HTMLDialogElement
const contactChallengeImage = document.getElementById('contact-challenge-image') as HTMLImageElement
const contactChallengeAnswer = document.getElementById('contact-challenge-answer') as HTMLInputElement
const contactChallengeNote = document.getElementById('contact-challenge-note')!
const contactChallengeSubmit = document.getElementById('contact-challenge-submit') as HTMLButtonElement
const contactChallengeRetry = document.getElementById('contact-challenge-retry') as HTMLButtonElement
const showConsentButton = document.getElementById('show-consent') as HTMLButtonElement
const consentDialog = document.getElementById('consent-dialog') as HTMLDialogElement
const consentFullText = document.getElementById('consent-full-text')!

let sessionId: string | null = null
let isSending = false
let consultationRetryAt = 0
let hasConsulted = false
let sessionClosingAt: number | null = null
type PhoneCodeState = 'idle' | 'loading' | 'waiting' | 'verifying' | 'sending' | 'cooldown'
let phoneCodeState: PhoneCodeState = 'idle'
let phoneCodeOperation = 0
let phoneCodeTarget = ''
let phoneCodeResendAt = 0
let challengeRetryAt = 0
const closedSessions = new Set<string>()

function syncSendButton(): void {
  sendButton.disabled = !questionInput.value.trim() || !sessionId || isSending || Date.now() < consultationRetryAt
}

function syncContactForm(): void {
  const phone = phoneInput.value.trim()
  const email = emailInput.value.trim()
  phoneVerification.hidden = !phone
  if (phoneCodeTarget && phone !== phoneCodeTarget && phoneCodeState !== 'sending') {
    onCancelContactChallenge()
  }
  syncPhoneCodeControls()
  submitContactButton.disabled = !phone && !email
  contactGuidance.hidden = hasConsulted
}

async function publicRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (init?.method === 'POST' && path.startsWith('/public/sessions/')) {
    if (!(await syncCurrentSession())) throw new PublicApiError(401, 'Session identity changed')
  }
  if (init?.method === 'POST' && path.startsWith('/public/sessions/') && path.split('/')[3] !== sessionId) {
    throw new PublicApiError(401, 'Session identity changed')
  }
  const response = await fetch(path, { credentials: 'include', ...init })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new PublicApiError(response.status, body.error ?? `HTTP_${response.status}`, Number(response.headers.get('Retry-After')) || 0)
  }
  return response.json() as Promise<T>
}

function addMessage(kind: 'user' | 'assistant', label: string, value: string): HTMLElement {
  const row = document.createElement('div')
  row.className = `chat-message ${kind}-message is-new`
  if (kind === 'assistant') {
    const avatar = document.createElement('span')
    avatar.className = 'message-avatar'
    avatar.setAttribute('aria-hidden', 'true')
    avatar.textContent = '园'
    row.append(avatar)
  }
  const content = document.createElement('div')
  content.className = 'message-content'
  const caption = document.createElement('span')
  caption.className = 'message-label'
  caption.textContent = label
  const paragraph = document.createElement(kind === 'assistant' ? 'div' : 'p')
  paragraph.className = kind === 'assistant' ? 'message-body markdown-body' : 'message-body'
  if (kind === 'assistant') renderMarkdown(paragraph, value)
  else paragraph.textContent = value
  content.append(caption, paragraph)
  row.append(content)
  log.append(row)
  log.scrollTop = log.scrollHeight
  return content
}

function addSystemMessage(value: string): void {
  const row = document.createElement('div')
  row.className = 'system-message is-new'
  row.textContent = value
  log.append(row)
  log.scrollTop = log.scrollHeight
}

function notifySessionClosed(id: string): void {
  if (closedSessions.has(id)) return
  closedSessions.add(id)
  sessionClosingAt = null
  sessionReminder.hidden = true
  addSystemMessage(t.sessionClosed)
}

async function sendQuestion(value: string): Promise<void> {
  const message = value.trim()
  if (!message || !sessionId || isSending || Date.now() < consultationRetryAt) return
  const targetId = sessionId
  isSending = true
  syncSendButton()
  try {
    if (!(await syncCurrentSession()) || sessionId !== targetId) {
      questionInput.value = message
      return
    }
  } catch {
    startHint.textContent = t.unavailable
    return
  } finally {
    isSending = false
    syncSendButton()
  }
  isSending = true
  syncSendButton()
  const userContent = addMessage('user', t.visitor, message)
  questionInput.value = ''
  const content = addMessage('assistant', t.assistant, t.sending)
  const paragraph = content.querySelector<HTMLElement>('.message-body')!
  try {
    const requestId =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (digit) =>
            (Number(digit) ^ (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (Number(digit) / 4))))
              .toString(16),
          )
    const send = () => fetch(`/public/sessions/${targetId}/messages`, {
      method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, client_request_id: requestId }),
    })
    const response = await send()
    if (response.status === 401) {
      const expiredId = sessionId
      notifySessionClosed(expiredId)
      await syncCurrentSession()
      throw new PublicApiError(401, 'Session expired')
    }
    if (response.status === 429) {
      const error = await response.clone().json() as { error?: string }
      if (error.error === 'CAPTCHA_REQUIRED') {
        userContent.parentElement?.remove()
        disposeMarkdown(paragraph)
        content.parentElement?.remove()
        questionInput.value = message
        syncSendButton()
        await showChallenge()
        return
      }
    }
    if (response.status === 429 || response.status === 503) {
      const error = await response.json().catch(() => ({})) as { error?: string }
      if (error.error === 'SESSION_CAPACITY_REACHED' || error.error === 'concurrent_limit') {
        consultationRetryAt = Date.now() + (Number(response.headers.get('Retry-After')) || 30) * 1000
        questionInput.value = message
        renderMarkdown(paragraph, error.error === 'SESSION_CAPACITY_REACHED' ? t.sessionCapacity : t.rateLimited)
        return
      }
    }
    if (!response.ok || !response.body) throw new Error(`${response.status}`)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    let answer = ''
    let isDone = false
    while (true) {
      const { value: bytes, done } = await reader.read()
      if (done) break
      pending += decoder.decode(bytes, { stream: true })
      let separator = pending.indexOf('\n\n')
      while (separator >= 0) {
        const frame = pending.slice(0, separator)
        pending = pending.slice(separator + 2)
        const event = /^event: (.+)$/m.exec(frame)?.[1]
        const payload = /^data: (.+)$/m.exec(frame)?.[1]
        if (event === 'delta' && payload) {
          answer += (JSON.parse(payload) as { text: string }).text
          renderMarkdown(paragraph, answer)
        }
        if (event === 'sources' && payload) renderSources(content, JSON.parse(payload) as SourceRef[], targetId)
        if (event === 'error') throw new Error('Assistant response failed')
        if (event === 'done') isDone = true
        separator = pending.indexOf('\n\n')
      }
      log.scrollTop = log.scrollHeight
    }
    if (!isDone) throw new Error('Assistant response interrupted')
    if (!answer) renderMarkdown(paragraph, t.noBasis)
    hasConsulted = true
    syncContactForm()
    if (sessionId === targetId) await pollSessionStatus()
  } catch (error) {
    if (error instanceof PublicApiError && error.code === 'SESSION_CAPACITY_REACHED') {
      consultationRetryAt = Date.now() + (error.retryAfter || 30) * 1000
      questionInput.value = message
      renderMarkdown(paragraph, t.sessionCapacity)
    } else {
      questionInput.value = message
      renderMarkdown(paragraph, error instanceof PublicApiError && error.status === 401 ? t.sessionChanged : t.unavailable)
    }
  } finally {
    isSending = false
    syncSendButton()
  }
}

async function showChallenge(): Promise<void> {
  if (!sessionId) return
  const challenge = await publicRequest<{ image: string }>(`/public/sessions/${sessionId}/challenge`)
  challengeImage.src = challenge.image
  challengePanel.hidden = false
  challengePanel.scrollIntoView({ behavior: 'smooth' })
}

function syncPhoneCodeControls(): void {
  const seconds = Math.max(0, Math.ceil((phoneCodeResendAt - Date.now()) / 1000))
  if (phoneCodeState === 'cooldown' && seconds === 0) {
    phoneCodeState = 'idle'
    codeNote.textContent = t.codeReady
  }
  sendCodeButton.disabled = !sessionId || !/^1[3-9]\d{9}$/.test(phoneInput.value.trim())
    || phoneCodeState !== 'idle' || seconds > 0
  sendCodeButton.textContent = seconds > 0
    ? t.codeResend.replace('{seconds}', String(seconds)) : t.sendCode
  contactChallengeSubmit.disabled = phoneCodeState !== 'waiting'
  contactChallengeAnswer.disabled = phoneCodeState !== 'waiting'
  phoneInput.readOnly = phoneCodeState === 'sending'
  const retrySeconds = Math.max(0, Math.ceil((challengeRetryAt - Date.now()) / 1000))
  contactChallengeRetry.disabled = retrySeconds > 0
    || phoneCodeState === 'loading' || phoneCodeState === 'verifying' || phoneCodeState === 'sending'
  if (contactChallenge.open && retrySeconds > 0) {
    contactChallengeNote.textContent = t.challengeRateLimited.replace('{seconds}', String(retrySeconds))
  } else if (challengeRetryAt && retrySeconds === 0) {
    challengeRetryAt = 0
    contactChallengeNote.textContent = t.challengeLoadError
  }
}

function onCancelContactChallenge(): void {
  contactChallenge.close()
  // An accepted SMS request cannot be cancelled by closing the dialog.
  if (phoneCodeState !== 'sending') {
    phoneCodeOperation++
    phoneCodeTarget = ''
    if (phoneCodeState !== 'cooldown') phoneCodeState = 'idle'
  }
  syncPhoneCodeControls()
}

async function showContactChallenge(): Promise<void> {
  if (!sessionId || phoneCodeState === 'sending' || phoneCodeState === 'verifying'
    || phoneCodeState === 'loading' || phoneCodeState === 'cooldown'
    || !/^1[3-9]\d{9}$/.test(phoneInput.value.trim())) return
  if (!contactChallenge.open) contactChallenge.showModal()
  if (Date.now() < challengeRetryAt) {
    contactChallengeRetry.hidden = false
    syncPhoneCodeControls()
    return
  }
  const operation = ++phoneCodeOperation
  phoneCodeTarget = phoneInput.value.trim()
  phoneCodeState = 'loading'
  contactChallengeAnswer.value = ''
  contactChallengeImage.removeAttribute('src')
  contactChallengeImage.hidden = true
  contactChallengeRetry.hidden = true
  contactChallengeNote.textContent = t.challengeLoading
  syncPhoneCodeControls()
  try {
    const challenge = await publicRequest<{ image: string }>(`/public/sessions/${sessionId}/challenge?purpose=contact`)
    if (operation !== phoneCodeOperation) return
    contactChallengeImage.src = challenge.image
    contactChallengeImage.hidden = false
    contactChallengeNote.textContent = ''
    phoneCodeState = 'waiting'
    syncPhoneCodeControls()
    contactChallengeAnswer.focus()
  } catch (error) {
    if (operation !== phoneCodeOperation) return
    phoneCodeState = 'idle'
    phoneCodeTarget = ''
    contactChallengeRetry.hidden = false
    challengeRetryAt = error instanceof PublicApiError && error.status === 429
      ? Date.now() + error.retryAfter * 1000 : 0
    contactChallengeNote.textContent = error instanceof PublicApiError && error.status === 401
      ? t.contactSessionExpired : t.challengeLoadError
    syncPhoneCodeControls()
  }
}

function contactErrorText(error: unknown): string {
  if (!(error instanceof PublicApiError)) return t.contactError
  const messages: Record<string, string> = {
    CONTACT_DISABLED: t.contactDisabled, CONSENT_REQUIRED: t.consentRequired,
    CONTACT_EMPTY: t.contactEmpty, PHONE_INVALID: t.phoneInvalid, EMAIL_INVALID: t.emailInvalid,
    PHONE_CODE_REQUIRED: t.phoneCodeRequired, PHONE_CODE_INVALID: t.phoneCodeInvalid,
    CAPTCHA_REQUIRED: t.captchaRequired, RATE_LIMITED: t.rateLimited, SMS_UNAVAILABLE: t.smsUnavailable,
  }
  return error.status === 401 ? t.contactSessionExpired : (messages[error.code] ?? t.contactError)
}

async function onSubmitContactChallenge(): Promise<void> {
  if (!sessionId || phoneCodeState !== 'waiting') return
  const operation = phoneCodeOperation
  const currentSessionId = sessionId
  const phone = phoneCodeTarget
  phoneCodeState = 'verifying'
  contactChallengeNote.textContent = t.challengeVerifying
  syncPhoneCodeControls()
  try {
    await publicRequest(`/public/sessions/${currentSessionId}/challenge/verify`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer: contactChallengeAnswer.value }),
    })
  } catch (error) {
    if (operation !== phoneCodeOperation) return
    phoneCodeState = 'waiting'
    contactChallengeNote.textContent = error instanceof PublicApiError && error.status === 401
      ? t.contactSessionExpired : t.challengeError
    contactChallengeRetry.hidden = false
    syncPhoneCodeControls()
    return
  }
  if (operation !== phoneCodeOperation || phone !== phoneInput.value.trim()
    || currentSessionId !== sessionId) {
    if (operation === phoneCodeOperation) onCancelContactChallenge()
    return
  }
  phoneCodeState = 'sending'
  contactChallengeNote.textContent = t.codeSending
  syncPhoneCodeControls()
  try {
    const result = await publicRequest<{ sent: boolean }>(`/public/sessions/${currentSessionId}/contact-code`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone }),
    })
    if (!result.sent) throw new Error('SMS send was not confirmed')
    phoneCodeResendAt = Date.now() + 60_000
    phoneCodeState = 'cooldown'
    codeNote.textContent = t.codeSent
  } catch (error) {
    phoneCodeState = 'idle'
    codeNote.textContent = contactErrorText(error)
  } finally {
    phoneCodeTarget = ''
    contactChallenge.close()
    syncPhoneCodeControls()
  }
}

async function refreshConsultedState(): Promise<void> {
  if (!sessionId) return
  try {
    const messages = await publicRequest<Array<{ redacted_question: string; redacted_answer: string; source_refs: SourceRef[] }>>(`/public/sessions/${sessionId}/messages`)
    hasConsulted = messages.length > 0
    for (const element of log.querySelectorAll('.chat-message, .system-message')) {
      for (const body of element.querySelectorAll<HTMLElement>('.markdown-body')) disposeMarkdown(body)
      element.remove()
    }
    for (const message of messages) {
      addMessage('user', t.visitor, message.redacted_question)
      const content = addMessage('assistant', t.assistant, message.redacted_answer)
      renderSources(content, message.source_refs, sessionId)
    }
  } catch {
    hasConsulted = false
  }
  syncContactForm()
}

async function createSession(): Promise<void> {
  const params = new URLSearchParams(location.search)
  try {
    const created = await publicRequest<{ session_id: string }>('/public/consult/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source_channel: params.get('channel') ?? 'web' }),
    })
    sessionId = created.session_id
    syncPhoneCodeControls()
    consultationRetryAt = 0
    sessionClosingAt = null
    syncSendButton()
    await refreshConsultedState()
    await pollSessionStatus()
  } catch (error) {
    if (error instanceof PublicApiError && error.code === 'SESSION_CAPACITY_REACHED') {
      consultationRetryAt = Date.now() + (error.retryAfter || 30) * 1000
      startHint.textContent = t.sessionCapacity
      syncSendButton()
    }
    throw error
  }
}

/** Resolve identity through the HttpOnly cookie before visitor writes. */
async function syncCurrentSession(): Promise<boolean> {
  const previousId = sessionId
  try {
    const current = await publicRequest<{ session_id: string }>('/public/consult/session')
    if (sessionId !== previousId) return false
    if (current.session_id === previousId) return true
    sessionId = current.session_id
    sessionClosingAt = null
    consultationRetryAt = 0
    onCancelContactChallenge()
    phoneCode.value = ''
    phoneCodeState = 'idle'
    phoneCodeResendAt = 0
    await refreshConsultedState()
    await pollSessionStatus()
  } catch (error) {
    if (!(error instanceof PublicApiError && error.status === 401)) throw error
    if (sessionId !== previousId) return false
    await createSession()
  }
  if (previousId) addSystemMessage(t.sessionChanged)
  syncContactForm()
  syncSendButton()
  return !previousId
}

function updateSessionReminder(): void {
  if (!sessionClosingAt) {
    sessionReminder.hidden = true
    return
  }
  const remaining = sessionClosingAt - Date.now()
  if (remaining <= 0) {
    if (sessionId) notifySessionClosed(sessionId)
    return
  }
  if (remaining > 5 * 60_000) {
    sessionReminder.hidden = true
    return
  }
  const seconds = Math.ceil(remaining / 1000)
  const countdown = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  sessionReminder.textContent = t.sessionClosing.replace('{time}', countdown)
  sessionReminder.hidden = false
}

async function pollSessionStatus(): Promise<void> {
  if (!sessionId || document.hidden) return
  const currentId = sessionId
  try {
    const status = await publicRequest<SessionStatus>(`/public/sessions/${currentId}/status`)
    if (status.closed) notifySessionClosed(currentId)
    else {
      sessionClosingAt = status.closing_at
      updateSessionReminder()
    }
  } catch (error) {
    if (error instanceof PublicApiError && error.status === 401) notifySessionClosed(currentId)
  }
}

async function start(): Promise<void> {
  try {
    const [context, questions] = await Promise.all([
      publicRequest<PublicContext>('/public/consult/context'),
      publicRequest<QuickQuestion[]>('/public/consult/quick-questions'),
    ])
    parkName.textContent = context.display_name || t.parkFallback
    footerPark.textContent = context.display_name || t.parkFallback
    document.title = `${context.display_name} · ${t.assistant}`
    consentFullText.textContent = context.consent_text || t.consent
    showConsentButton.hidden = !context.consent_text
    setParkFavicon(context.logo_url)
    brandLogo.onerror = () => {
      brandLogo.hidden = true
      brandMark.hidden = false
    }
    brandLogo.src = parkLogoUrl(context.logo_url)
    brandLogo.hidden = false
    brandMark.hidden = true
    document.getElementById('open-contact')!.toggleAttribute('hidden', !context.contact_enabled)
    for (const item of questions.slice(0, 8)) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = item.question
      button.addEventListener('click', () => void sendQuestion(item.question))
      chips.append(button)
    }
    await createSession()
    startHint.textContent = context.welcome_text || t.startHint
  } catch (error) {
    if (!(error instanceof PublicApiError && error.code === 'SESSION_CAPACITY_REACHED')) startHint.textContent = t.unavailable
  }
}

questionInput.addEventListener('input', syncSendButton)
questionInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  questionForm.requestSubmit()
})
questionForm.addEventListener('submit', (event) => { event.preventDefault(); void sendQuestion(questionInput.value) })
document.getElementById('open-contact')!.addEventListener('click', () => {
  contactSection.hidden = false
  syncContactForm()
  contactSection.scrollIntoView({ behavior: 'smooth' })
})
document.getElementById('close-contact')!.addEventListener('click', () => {
  onCancelContactChallenge()
  contactSection.hidden = true
  document.getElementById('open-contact')!.focus()
})
challengeForm.addEventListener('submit', (event) => {
  event.preventDefault()
  if (!sessionId) return
  const answer = (document.getElementById('challenge-answer') as HTMLInputElement).value
  void publicRequest(`/public/sessions/${sessionId}/challenge/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answer }),
  }).then(() => { challengePanel.hidden = true; questionInput.focus() })
    .catch(() => { challengeNote.textContent = t.challengeError })
})
phoneInput.addEventListener('input', syncContactForm)
emailInput.addEventListener('input', syncContactForm)
sendCodeButton.addEventListener('click', () => {
  if (!sendCodeButton.disabled) void showContactChallenge()
})
contactChallengeRetry.addEventListener('click', () => void showContactChallenge())
contactChallengeSubmit.addEventListener('click', () => void onSubmitContactChallenge())
contactChallengeAnswer.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    void onSubmitContactChallenge()
  }
})
document.getElementById('close-contact-challenge')!.addEventListener('click', onCancelContactChallenge)
contactChallenge.addEventListener('click', (event) => {
  if (event.target === contactChallenge) onCancelContactChallenge()
})
contactChallenge.addEventListener('cancel', (event) => {
  event.preventDefault()
  onCancelContactChallenge()
})
showConsentButton.addEventListener('click', () => consentDialog.showModal())
document.getElementById('close-consent')!.addEventListener('click', () => consentDialog.close())
consentDialog.addEventListener('click', (event) => { if (event.target === consentDialog) consentDialog.close() })
contactForm.addEventListener('submit', (event) => {
  event.preventDefault()
  if (!sessionId) return
  const data = new FormData(contactForm)
  void publicRequest(`/public/sessions/${sessionId}/contact`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: data.get('name'), company_name: data.get('company'), phone: data.get('phone'),
      email: data.get('email'), sms_code: phoneCode.value, consent: data.get('consent') === 'on',
    }),
  }).then(() => {
    contactNote.textContent = t.contactSuccess
    contactForm.reset()
    onCancelContactChallenge()
    syncContactForm()
  }).catch((error: unknown) => { contactNote.textContent = contactErrorText(error) })
})
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    syncPhoneCodeControls()
    void syncCurrentSession().then(() => pollSessionStatus()).catch(() => {})
  }
})
window.setInterval(() => void pollSessionStatus(), 30_000)
window.setInterval(() => {
  updateSessionReminder()
  syncSendButton()
}, 1000)
window.setInterval(syncPhoneCodeControls, 1000)

syncContactForm()
void start()
