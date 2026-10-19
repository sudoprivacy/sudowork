import { zh as t } from './locale'
import './style.css'

interface PublicContext {
  display_name: string
  logo_url: string | null
  welcome_text: string
  contact_enabled: boolean
  published_policy_version: string | null
}

interface QuickQuestion {
  id: string
  question: string
  sort_order: number
}
interface SourceRef {
  policy_id?: string
  name: string
  version: string
  section: string
}

const root = document.getElementById('app')!
root.innerHTML = `
  <div class="consult-page">
    <header class="page-header">
      <div class="consult-brand"><span class="brand-mark" id="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span><img class="brand-logo" id="brand-logo" alt="" hidden><span><strong id="park-name"></strong></span></div>
      <button class="header-contact" type="button" id="open-contact">${t.contactPark} <span aria-hidden="true">↗</span></button>
    </header>
    <main class="consult-main-new">
      <section class="chat-card" aria-label="${t.assistant}">
        <div class="chat-heading"><span class="assistant-seal" aria-hidden="true">园</span><div class="assistant-heading"><strong>${t.assistant}</strong><span>${t.assistantBasis}</span></div><span class="chat-ready"><span class="status-dot" aria-hidden="true"></span>${t.ready}</span></div>
        <div class="question-area"><div class="question-caption"><strong>${t.quickQuestions}</strong><span>${t.quickHint}</span></div><div class="question-chips" id="question-chips"></div></div>
        <div class="chat-log" id="chat-log" role="log" aria-live="polite"><div class="conversation-start" id="start-hint">${t.loading}</div></div>
        <form class="question-composer" id="question-form"><label class="sr-only" for="question-input">${t.inputLabel}</label><textarea id="question-input" rows="2" placeholder="${t.inputPlaceholder}"></textarea><div class="composer-actions"><span>${t.sensitiveHint}</span><button type="submit">${t.send} <span aria-hidden="true">→</span></button></div></form>
        <p class="chat-disclaimer">${t.disclaimer}</p>
      </section>
      <section class="captcha-panel" id="challenge-panel" hidden><div><strong>${t.challengeTitle}</strong><p>${t.challengeHint}</p></div><img id="challenge-image" alt="${t.challengeAnswer}"><form id="challenge-form"><label class="sr-only" for="challenge-answer">${t.challengeAnswer}</label><input id="challenge-answer" maxlength="5" placeholder="${t.challengeAnswer}"><button type="submit">${t.challengeSubmit}</button></form><small id="challenge-note"></small></section>
      <section class="contact-form-section" id="contact-section" hidden aria-labelledby="contact-title"><div class="form-heading"><div><h2 id="contact-title">${t.contactTitle}</h2><p>${t.contactDescription}</p></div><button class="form-close" type="button" id="close-contact" aria-label="${t.close}">×</button></div>
        <form id="contact-form"><div class="fields">
          <label>${t.name} <small>${t.optional}</small><input name="name" autocomplete="name" placeholder="${t.namePlaceholder}"></label>
          <label>${t.company} <small>${t.optional}</small><input name="company" autocomplete="organization" placeholder="${t.companyPlaceholder}"></label>
          <label>${t.phone} <small>${t.optional}</small><input name="phone" type="tel" autocomplete="tel" placeholder="${t.phonePlaceholder}"></label>
          <label>${t.email} <small>${t.optional}</small><input name="email" type="email" autocomplete="email" placeholder="${t.emailPlaceholder}"></label>
        </div><div class="p1-panel"><div class="p1-title"><span>P1</span><strong>${t.phoneVerification}</strong></div><div class="otp-row"><input id="phone-code" inputmode="numeric" maxlength="6" aria-label="${t.phoneVerification}" placeholder="${t.codePlaceholder}"><button type="button" id="send-code">${t.sendCode}</button><button type="button" id="verify-code">${t.verifyCode}</button></div><small id="code-note"></small></div><label class="consent"><input name="consent" type="checkbox" required><span>${t.consent}</span></label><div class="form-actions"><button class="submit-contact" type="submit">${t.submitContact} →</button><span id="contact-note">${t.contactHint}</span></div></form>
      </section>
    </main>
    <footer class="consult-footer-new"><span id="footer-park"></span><span>${t.disclaimer}</span></footer>
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
const contactSection = document.getElementById('contact-section')!
const contactForm = document.getElementById('contact-form') as HTMLFormElement
const contactNote = document.getElementById('contact-note')!
const codeNote = document.getElementById('code-note')!
const challengePanel = document.getElementById('challenge-panel')!
const challengeImage = document.getElementById('challenge-image') as HTMLImageElement
const challengeForm = document.getElementById('challenge-form') as HTMLFormElement
const challengeNote = document.getElementById('challenge-note')!
let sessionId: string | null = null
let isSending = false

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', ...init })
  if (!response.ok) throw new Error(`${response.status}`)
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
  const paragraph = document.createElement('p')
  paragraph.textContent = value
  content.append(caption, paragraph)
  row.append(content)
  log.append(row)
  log.scrollTop = log.scrollHeight
  return content
}

function addSources(content: HTMLElement, sources: SourceRef[]): void {
  for (const source of sources) {
    const card = document.createElement('div')
    card.className = 'policy-source'
    const icon = document.createElement('span')
    icon.className = 'source-icon'
    icon.textContent = '▤'
    const details = document.createElement('div')
    const label = document.createElement('span')
    label.className = 'source-label'
    label.textContent = source.policy_id ? t.sourceLabel : t.materialSourceLabel
    const title = document.createElement('strong')
    title.textContent = source.name
    const location = document.createElement('span')
    location.textContent = `${source.version} · ${source.section}`
    details.append(label, title, location)
    card.append(icon, details)
    content.append(card)
  }
}

async function sendQuestion(value: string): Promise<void> {
  const message = value.trim()
  if (!message || !sessionId || isSending) return
  isSending = true
  const userContent = addMessage('user', t.visitor, message)
  questionInput.value = ''
  const content = addMessage('assistant', t.assistant, t.sending)
  const paragraph = content.querySelector('p')!
  try {
    const response = await fetch(`/public/sessions/${sessionId}/messages`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, client_request_id: crypto.randomUUID() }),
    })
    if (response.status === 429) {
      const error = (await response.json()) as { error?: string }
      if (error.error === 'CAPTCHA_REQUIRED') {
        userContent.parentElement?.remove()
        content.parentElement?.remove()
        questionInput.value = message
        await showChallenge()
        return
      }
    }
    if (!response.ok || !response.body) throw new Error(`${response.status}`)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    let answer = ''
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
          paragraph.textContent = answer
        }
        if (event === 'sources' && payload) addSources(content, JSON.parse(payload) as SourceRef[])
        separator = pending.indexOf('\n\n')
      }
      log.scrollTop = log.scrollHeight
    }
    if (!answer) paragraph.textContent = t.noBasis
  } catch {
    paragraph.textContent = t.unavailable
  } finally {
    isSending = false
  }
}

async function showChallenge(): Promise<void> {
  if (!sessionId) return
  const challenge = await json<{ image: string }>(`/public/sessions/${sessionId}/challenge`)
  challengeImage.src = challenge.image
  challengePanel.hidden = false
  challengePanel.scrollIntoView({ behavior: 'smooth' })
}

async function start(): Promise<void> {
  try {
    const [context, questions] = await Promise.all([
      json<PublicContext>('/public/consult/context'),
      json<QuickQuestion[]>('/public/consult/quick-questions'),
    ])
    parkName.textContent = context.display_name || t.parkFallback
    footerPark.textContent = context.display_name || t.parkFallback
    document.title = `${context.display_name} · ${t.assistant}`
    if (context.logo_url) {
      const logoUrl = new URL(context.logo_url, location.origin)
      if (logoUrl.protocol === 'http:' || logoUrl.protocol === 'https:') {
        brandLogo.src = logoUrl.href
        brandLogo.hidden = false
        brandMark.hidden = true
        brandLogo.onerror = () => {
          brandLogo.hidden = true
          brandMark.hidden = false
        }
      }
    }
    document.getElementById('open-contact')!.toggleAttribute('hidden', !context.contact_enabled)
    for (const item of questions.slice(0, 8)) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = item.question
      button.addEventListener('click', () => void sendQuestion(item.question))
      chips.append(button)
    }
    const params = new URLSearchParams(location.search)
    const created = await json<{ session_id: string }>('/public/consult/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source_channel: params.get('channel') ?? 'web',
      }),
    })
    sessionId = created.session_id
    startHint.textContent = context.welcome_text || t.startHint
  } catch {
    startHint.textContent = t.unavailable
  }
}

questionForm.addEventListener('submit', (event) => {
  event.preventDefault()
  void sendQuestion(questionInput.value)
})
document.getElementById('open-contact')!.addEventListener('click', () => {
  contactSection.hidden = false
  contactSection.scrollIntoView({ behavior: 'smooth' })
})
document.getElementById('close-contact')!.addEventListener('click', () => {
  contactSection.hidden = true
  document.getElementById('open-contact')!.focus()
})
challengeForm.addEventListener('submit', (event) => {
  event.preventDefault()
  if (!sessionId) return
  const answer = (document.getElementById('challenge-answer') as HTMLInputElement).value
  void json(`/public/sessions/${sessionId}/challenge/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answer }),
  })
    .then(() => {
      challengePanel.hidden = true
      questionInput.focus()
    })
    .catch(() => {
      challengeNote.textContent = t.challengeError
    })
})
document.getElementById('send-code')!.addEventListener('click', () => {
  if (!sessionId) return
  const phone = (contactForm.elements.namedItem('phone') as HTMLInputElement).value
  void json(`/public/sessions/${sessionId}/contact-code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone }),
  })
    .then(() => {
      codeNote.textContent = t.codeSent
    })
    .catch(() => {
      codeNote.textContent = t.codeError
    })
})
document.getElementById('verify-code')!.addEventListener('click', () => {
  if (!sessionId) return
  const phone = (contactForm.elements.namedItem('phone') as HTMLInputElement).value
  const code = (document.getElementById('phone-code') as HTMLInputElement).value
  void json(`/public/sessions/${sessionId}/contact-code/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, code }),
  })
    .then(() => {
      codeNote.textContent = t.codeVerified
    })
    .catch(() => {
      codeNote.textContent = t.codeError
    })
})
contactForm.addEventListener('submit', (event) => {
  event.preventDefault()
  if (!sessionId) return
  const data = new FormData(contactForm)
  void json(`/public/sessions/${sessionId}/contact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: data.get('name'),
      company_name: data.get('company'),
      phone: data.get('phone'),
      email: data.get('email'),
      consent: data.get('consent') === 'on',
    }),
  })
    .then(() => {
      contactNote.textContent = t.contactSuccess
      contactForm.reset()
    })
    .catch(() => {
      contactNote.textContent = t.contactError
    })
})

void start()
