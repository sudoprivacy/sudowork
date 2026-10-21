import { useCallback, useEffect, useRef, useState } from 'react'
import { ParkApiError, type ParkApi } from './api'
import { DEFAULT_PARK_LOGO, parkLogoUrl } from '../brand'
import { encodeLogo, isValidLogo, LOGO_ACCEPT } from './logoUpload'
import type { PageId } from './index'
import { parkLabels as t } from './labels'
import { isPolicyFileName, POLICY_FILE_ACCEPT, POLICY_FILE_MAX_BYTES } from './policyUpload'
import styles from './park.module.css'

interface Config {
  display_name: string
  logo_url: string | null
  welcome_text: string
  park_profile: string
  service_catalog: string
  service_catalog_version: string
  contact_enabled: number
  consent_text: string
}
interface PolicyNode {
  id: string
  parentId: string | null
  name: string
  autoManaged: boolean
}
interface PolicyDocument {
  id: string
  nodeId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  uploadedAt: number
}
interface PolicyWiki {
  id: string
  name: string
  buildStatus: 'pending' | 'running' | 'succeeded' | 'failed'
  sourceDocumentIds: string[]
  lastBuiltAt: number | null
  lastBuildError: string | null
}
interface PolicyBuildStatus {
  wiki_build_status: PolicyWiki['buildStatus']
  last_built_at: number | null
  last_build_error: string | null
}
interface QuickQuestion {
  id: string
  question: string
  sort_order: number
  enabled: number
}
interface ConfigValue {
  value: Record<string, unknown>
  status?: string
}
interface PublicLinks {
  public_url: string | null
  links: Array<{ id: string; channel: string; label: string; enabled: number }>
}
interface AuditEvent {
  id: string
  actor_user_id: string | null
  actor_name: string | null
  action_label: string
  object_label: string
  action: string
  resource: string
  method: string
  path: string
  response_status: number
  ip_address: string | null
  created_at: number
}
interface BoxStatus {
  version: string | null
  uptime_seconds: number
  memory: { total_bytes: number; free_bytes: number }
  disk: { total_bytes: number; free_bytes: number }
  health: Array<{ url: string; healthy: boolean; status: number }>
  model: unknown
  archives: string[]
  upgrades: string[]
  available_actions: Record<string, boolean>
}

function localTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value)
}

function Feedback({ message, isError }: { message: string; isError?: boolean }) {
  return message ? (
    <p className={isError ? styles.errorLine : styles.statusLine}>{message}</p>
  ) : null
}

function failureReason(error: unknown): string {
  if (error instanceof ParkApiError) {
    const reason = error.reason
    if (!reason) return `${t.serverReasonUnavailable}（HTTP ${error.status}）`
    return t.assistantErrors[reason as keyof typeof t.assistantErrors] ?? reason
  }
  return error instanceof TypeError ? t.networkFailure : t.serverReasonUnavailable
}

function PoliciesPage({ api }: { api: ParkApi }) {
  const [nodes, setNodes] = useState<PolicyNode[]>([])
  const [documents, setDocuments] = useState<PolicyDocument[]>([])
  const [wikis, setWikis] = useState<PolicyWiki[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const [selectedWikiId, setSelectedWikiId] = useState('')
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([])
  const [buildStatus, setBuildStatus] = useState<PolicyBuildStatus | null>(null)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState('')
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
  }, [])
  function requestDelete(documentId: string): void {
    if (confirmDeleteId === documentId) {
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
      setConfirmDeleteId('')
      void onDeleteDocument(documentId)
      return
    }
    setConfirmDeleteId(documentId)
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    confirmTimer.current = setTimeout(() => setConfirmDeleteId(''), 3000)
  }
  const reload = useCallback(async () => {
    const [tree, wikiRows] = await Promise.all([
      api.get<{ nodes: PolicyNode[] }>('admin/policy/tree'),
      api.get<{ wikis: PolicyWiki[] }>('admin/policy/wikis'),
    ])
    const editableNodes = tree.nodes.filter((node) => !node.autoManaged)
    setNodes(editableNodes)
    setWikis(wikiRows.wikis)
    setSelectedNodeId((current) => current || editableNodes[0]?.id || '')
    setSelectedWikiId((current) => current || wikiRows.wikis[0]?.id || '')
  }, [api])
  useEffect(() => {
    void reload().catch(() => {
      setMessage(t.failed)
      setIsError(true)
    })
  }, [reload])
  useEffect(() => {
    if (!selectedNodeId) {
      setDocuments([])
      return
    }
    void api.get<{ documents: PolicyDocument[] }>(
      `admin/policy/nodes/${encodeURIComponent(selectedNodeId)}/documents`,
    ).then((result) => setDocuments(result.documents)).catch(() => {
      setMessage(t.failed)
      setIsError(true)
    })
  }, [api, selectedNodeId])
  useEffect(() => {
    const wiki = wikis.find((item) => item.id === selectedWikiId)
    setSelectedDocumentIds(wiki?.sourceDocumentIds ?? [])
  }, [selectedWikiId, wikis])
  useEffect(() => {
    if (!selectedWikiId) {
      setBuildStatus(null)
      return
    }
    let isCancelled = false
    let timer: number | undefined
    const poll = async () => {
      try {
        const status = await api.get<PolicyBuildStatus>(
          `admin/policy/wikis/${encodeURIComponent(selectedWikiId)}/build-status`,
        )
        if (isCancelled) return
        setBuildStatus(status)
        if (status.wiki_build_status === 'pending' || status.wiki_build_status === 'running') {
          timer = window.setTimeout(() => void poll(), 2000)
        }
      } catch {
        if (!isCancelled) {
          setMessage(t.failed)
          setIsError(true)
        }
      }
    }
    void poll()
    return () => {
      isCancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [api, selectedWikiId])

  async function onCreateNode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)
    const form = event.currentTarget
    const values = new FormData(form)
    try {
      await api.send('admin/policy/tree/nodes', 'POST', {
        name: values.get('name'),
        parent_id: values.get('parent_id') || null,
      })
      form.reset()
      await reload()
      setMessage(t.saved)
      setIsError(false)
    } catch {
      setMessage(t.saveFailed)
      setIsError(true)
    } finally {
      setIsSaving(false)
    }
  }
  async function onUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || !selectedNodeId) return
    if (!isPolicyFileName(file.name) || !file.size || file.size > POLICY_FILE_MAX_BYTES) {
      setMessage(!isPolicyFileName(file.name) ? t.policyFileUnsupported : !file.size ? t.policyFileEmpty : t.policyFileTooLarge)
      setIsError(true)
      event.target.value = ''
      return
    }
    const input = event.currentTarget
    setIsSaving(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      await api.send(`admin/policy/nodes/${encodeURIComponent(selectedNodeId)}/documents`, 'POST', {
        file_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        content_base64: btoa(binary),
      })
      const result = await api.get<{ documents: PolicyDocument[] }>(
        `admin/policy/nodes/${encodeURIComponent(selectedNodeId)}/documents`,
      )
      setDocuments(result.documents)
      setMessage(t.saved)
      setIsError(false)
    } catch (error) {
      setMessage(`${t.policyUploadFailed}${failureReason(error)}`)
      setIsError(true)
    } finally {
      setIsSaving(false)
      input.value = ''
    }
  }
  async function onDeleteDocument(id: string) {
    setIsSaving(true)
    try {
      await api.send(`admin/policy/documents/${encodeURIComponent(id)}`, 'DELETE')
      setDocuments((current) => current.filter((document) => document.id !== id))
      setSelectedDocumentIds((current) => current.filter((documentId) => documentId !== id))
      setMessage(t.saved)
      setIsError(false)
    } catch {
      setMessage(t.saveFailed)
      setIsError(true)
    } finally {
      setIsSaving(false)
    }
  }
  async function onCreateWiki(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedDocumentIds.length) return
    setIsSaving(true)
    const form = event.currentTarget
    try {
      const wiki = await api.send<PolicyWiki>('admin/policy/wikis', 'POST', {
        name: new FormData(form).get('name'),
        source_document_ids: selectedDocumentIds,
      })
      form.reset()
      await reload()
      setSelectedWikiId(wiki.id)
      setMessage(t.saved)
      setIsError(false)
    } catch {
      setMessage(t.saveFailed)
      setIsError(true)
    } finally {
      setIsSaving(false)
    }
  }
  async function onSaveAndBuild() {
    if (!selectedWikiId || !selectedDocumentIds.length) return
    setIsSaving(true)
    try {
      await api.send(`admin/policy/wikis/${encodeURIComponent(selectedWikiId)}`, 'PATCH', {
        source_document_ids: selectedDocumentIds,
      })
      await api.send(`admin/policy/wikis/${encodeURIComponent(selectedWikiId)}/build`, 'POST')
      setBuildStatus({ wiki_build_status: 'pending', last_built_at: null, last_build_error: null })
      setMessage(t.policyBuildStarted)
      setIsError(false)
      await reload()
    } catch {
      setMessage(t.saveFailed)
      setIsError(true)
    } finally {
      setIsSaving(false)
    }
  }
  return (
    <>
      <Feedback message={message} isError={isError} />
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>{t.policyDirectory}</h2>
        <form className={styles.formGrid} onSubmit={(event) => void onCreateNode(event)}>
          <label className={styles.field}>{t.policyDirectoryName}<input className={styles.input} name="name" required /></label>
          <label className={styles.field}>{t.policyParentDirectory}<select className={styles.select} name="parent_id" defaultValue=""><option value="">{t.policyRootDirectory}</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
          <button className={styles.button} type="submit" disabled={isSaving}>{t.create}</button>
        </form>
        <div className={styles.sectionGap}>
          <label className={styles.field}>{t.policyCurrentDirectory}<select className={styles.select} value={selectedNodeId} onChange={(event) => setSelectedNodeId(event.target.value)}><option value="">{t.empty}</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
        </div>
      </section>
      <section className={`${styles.panel} ${styles.sectionGap}`}>
        <h2 className={styles.panelTitle}>{t.policyFiles}</h2>
        <label className={styles.field}>{t.policyUpload}<input className={styles.input} type="file" accept={POLICY_FILE_ACCEPT} onChange={(event) => void onUpload(event)} disabled={!selectedNodeId || isSaving} /></label>
        <div className={styles.list}>{documents.length ? documents.map((document) => <div className={styles.listItem} key={document.id}><div><strong>{document.fileName}</strong><p className={styles.muted}>{Math.ceil(document.sizeBytes / 1024)} KB · {localTime(document.uploadedAt)}</p></div><button className={styles.buttonDanger} type="button" onClick={() => requestDelete(document.id)} disabled={isSaving}>{confirmDeleteId === document.id ? t.documentDeleteConfirm : t.documentDelete}</button></div>) : <div className={styles.empty}>{t.empty}</div>}</div>
      </section>
      <section className={`${styles.panel} ${styles.sectionGap}`}>
        <h2 className={styles.panelTitle}>{t.policyKnowledgeBase}</h2>
        <label className={styles.field}>{t.policyWiki}<select className={styles.select} value={selectedWikiId} onChange={(event) => setSelectedWikiId(event.target.value)}><option value="">{t.policyCreateWiki}</option>{wikis.map((wiki) => <option key={wiki.id} value={wiki.id}>{wiki.name}</option>)}</select></label>
        <div className={styles.list}>{documents.map((document) => <label className={styles.listItem} key={document.id}><span><input type="checkbox" checked={selectedDocumentIds.includes(document.id)} onChange={(event) => setSelectedDocumentIds((current) => event.target.checked ? [...new Set([...current, document.id])] : current.filter((id) => id !== document.id))} /> {document.fileName}</span></label>)}</div>
        {!selectedWikiId && <form className={styles.formGrid} onSubmit={(event) => void onCreateWiki(event)}><label className={styles.field}>{t.policyWikiName}<input className={styles.input} name="name" required /></label><button className={styles.button} type="submit" disabled={isSaving || !selectedDocumentIds.length}>{t.policyCreateWiki}</button></form>}
        {selectedWikiId && <div className={styles.inlineActions}><button className={styles.button} type="button" onClick={() => void onSaveAndBuild()} disabled={isSaving || !selectedDocumentIds.length}>{t.policySaveAndBuild}</button><span className={styles.pill}>{buildStatus ? (t.policyBuildStatuses[buildStatus.wiki_build_status] ?? buildStatus.wiki_build_status) : t.loading}</span>{buildStatus?.last_build_error && <span className={styles.errorLine}>{buildStatus.last_build_error}</span>}</div>}
      </section>
    </>
  )
}

function ContentSettingsPage({ api, onBrandSaved }: IContentSettingsPageProps) {
  const [config, setConfig] = useState<Config | null>(null)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState('')
  useEffect(() => {
    if (!logoFile) {
      setLogoPreview('')
      return
    }
    const url = URL.createObjectURL(logoFile)
    setLogoPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [logoFile])
  function onLogoSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    if (file && !isValidLogo(file)) {
      setLogoFile(null)
      event.target.value = ''
      setMessage(t.logoInvalid)
      setIsError(true)
      return
    }
    setLogoFile(file)
    setMessage('')
    setIsError(false)
  }
  const reload = useCallback(async () => setConfig(await api.get<Config>('admin/config')), [api])
  useEffect(() => {
    void reload().catch(() => {
      setMessage(t.failed)
      setIsError(true)
    })
  }, [reload])
  async function onConfig(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    try {
      const catalog = JSON.parse(String(form.get('service_catalog') ?? '[]')) as unknown
      const updated = await api.send<Config>('admin/config', 'PUT', {
        display_name: form.get('display_name'),
        ...(logoFile ? { logo_upload: await encodeLogo(logoFile) } : {}),
        welcome_text: form.get('welcome_text'),
        park_profile: form.get('park_profile'),
        service_catalog: catalog,
        service_catalog_version: form.get('service_catalog_version'),
        contact_enabled: form.get('contact_enabled') === 'on',
        consent_text: form.get('consent_text'),
      })
      setConfig(updated)
      setLogoFile(null)
      const fileInput = formElement.querySelector<HTMLInputElement>('input[name="logo_upload"]')
      if (fileInput) fileInput.value = ''
      onBrandSaved(updated)
      setMessage(t.saved)
      setIsError(false)
    } catch {
      setMessage(t.saveFailed)
      setIsError(true)
    } finally {
      setIsSaving(false)
    }
  }
  return (
    <>
      <Feedback message={message} isError={isError} />
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>
          {t.parkProfile} / {t.serviceCatalog}
        </h2>
        <form
          className={`${styles.formGrid} ${styles.contentForm}`}
          onSubmit={(event) => void onConfig(event)}
          key={(config?.display_name ?? 'new') + (config?.service_catalog_version ?? '')}
        >
          <label className={styles.field}>
            {t.displayName}
            <input
              className={styles.input}
              name="display_name"
              defaultValue={config?.display_name ?? ''}
              required
            />
          </label>
          <label className={styles.field}>
            {t.welcomeText}
            <input
              className={styles.input}
              name="welcome_text"
              defaultValue={config?.welcome_text ?? ''}
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            {t.logoUrl}
            <input
              className={styles.input}
              type="file"
              name="logo_upload"
              accept={LOGO_ACCEPT}
              onChange={onLogoSelected}
              disabled={isSaving}
              aria-describedby="logo-upload-hint"
            />
            <span id="logo-upload-hint" className={styles.muted}>
              {t.logoUploadHint}
            </span>
            <img
              className={styles.brandLogo}
              src={logoPreview || parkLogoUrl(config?.logo_url)}
              alt=""
              onError={(event) => {
                event.currentTarget.onerror = null
                event.currentTarget.src = DEFAULT_PARK_LOGO
              }}
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            {t.parkProfile}
            <textarea
              className={styles.textarea}
              name="park_profile"
              defaultValue={config?.park_profile ?? ''}
            />
          </label>
          <label className={styles.field}>
            {t.serviceCatalogVersion}
            <input
              className={styles.input}
              name="service_catalog_version"
              defaultValue={config?.service_catalog_version ?? '1'}
              required
            />
          </label>
          <label className={styles.field}>
            {t.contactEnabled}
            <input
              type="checkbox"
              name="contact_enabled"
              defaultChecked={config ? Boolean(config.contact_enabled) : true}
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            {t.serviceCatalog}
            <textarea
              className={styles.textarea}
              name="service_catalog"
              defaultValue={
                config ? JSON.stringify(JSON.parse(config.service_catalog), null, 2) : '[]'
              }
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            {t.consentText}
            <textarea
              className={styles.textarea}
              name="consent_text"
              maxLength={2000}
              defaultValue={config?.consent_text ?? ''}
            />
          </label>
          <button className={styles.button} type="submit" disabled={isSaving}>
            {t.save}
          </button>
        </form>
      </section>
      <div className={styles.sectionGap}>
        <QuestionsPage api={api} />
      </div>
    </>
  )
}

function QuestionsPage({ api }: { api: ParkApi }) {
  const [rows, setRows] = useState<QuickQuestion[]>([])
  const [editing, setEditing] = useState<QuickQuestion | null>(null)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const reload = useCallback(
    async () => setRows(await api.get<QuickQuestion[]>('admin/quick-questions')),
    [api],
  )
  useEffect(() => {
    void reload().catch(() => {
      setMessage(t.failed)
      setIsError(true)
    })
  }, [reload])
  async function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    try {
      await api.send('admin/quick-questions', 'POST', {
        id: editing?.id,
        question: values.get('question'),
        sort_order: Number(values.get('sort_order')),
        enabled: values.get('enabled') === 'on',
      })
      setEditing(null)
      form.reset()
      await reload()
      setMessage(t.saved)
      setIsError(false)
    } catch {
      setMessage(t.saveFailed)
      setIsError(true)
    }
  }
  async function onDelete(id: string) {
    try {
      await api.send(`admin/quick-questions/${encodeURIComponent(id)}`, 'DELETE')
      await reload()
      setMessage(t.saved)
      setIsError(false)
    } catch {
      setMessage(t.saveFailed)
      setIsError(true)
    }
  }
  return (
    <>
      <Feedback message={message} isError={isError} />
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>{t.questions}</h2>
        <div className={styles.list}>
          {rows.length ? (
            rows.map((row) => (
              <div className={styles.listItem} key={row.id}>
                <div className={styles.inlineActions}>
                  <strong>{row.question}</strong>
                  <span className={styles.pill}>{row.enabled ? t.enabled : t.disabled}</span>
                  <span className={styles.muted}>
                    {t.order} {row.sort_order}
                  </span>
                  <button
                    className={styles.buttonSecondary}
                    type="button"
                    onClick={() => setEditing(row)}
                  >
                    {t.edit}
                  </button>
                  <button
                    className={styles.buttonDanger}
                    type="button"
                    onClick={() => void onDelete(row.id)}
                  >
                    {t.close}
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className={styles.empty}>{t.empty}</div>
          )}
        </div>
        <h2 className={`${styles.panelTitle} ${styles.sectionGap}`}>{editing ? t.edit : t.create}</h2>
        <form
          className={styles.formGrid}
          onSubmit={(event) => void onSave(event)}
          key={editing?.id ?? 'new'}
        >
          <label className={`${styles.field} ${styles.fieldWide}`}>
            {t.question}
            <input
              className={styles.input}
              name="question"
              defaultValue={editing?.question ?? ''}
              required
            />
          </label>
          <label className={styles.field}>
            {t.order}
            <input
              className={styles.input}
              type="number"
              name="sort_order"
              defaultValue={editing?.sort_order ?? rows.length + 1}
            />
          </label>
          <label className={styles.field}>
            {t.enabled}
            <input type="checkbox" name="enabled" defaultChecked={editing?.enabled !== 0} />
          </label>
          <div className={styles.inlineActions}>
            <button className={styles.button} type="submit">
              {t.save}
            </button>
            {editing && (
              <button
                className={styles.buttonSecondary}
                type="button"
                onClick={() => setEditing(null)}
              >
                {t.cancel}
              </button>
            )}
          </div>
        </form>
      </section>
    </>
  )
}

interface WikiSourceDocument {
  id: string
  fileName: string | null
  nodeName: string | null
  sizeBytes: number | null
  status: 'available' | 'deleted' | 'unavailable'
}
interface WikiSourcesResult {
  built_at: number | null
  record_status: 'available' | 'unavailable'
  sources: WikiSourceDocument[]
}

function AssistantPage({ api }: { api: ParkApi }) {
  const [data, setData] = useState<ConfigValue | null>(null)
  const [wikis, setWikis] = useState<PolicyWiki[]>([])
  const [sourceResult, setSourceResult] = useState<WikiSourcesResult | null>(null)
  const [isSourcesLoading, setIsSourcesLoading] = useState(false)
  const [isSourcesError, setIsSourcesError] = useState(false)
  const [sourceRetry, setSourceRetry] = useState(0)
  const [message, setMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isSaveError, setIsSaveError] = useState(false)
  const reload = useCallback(async () => {
    const [assistant, wikiRows] = await Promise.all([
      api.get<ConfigValue>('admin/assistant'),
      api.get<{ wikis: PolicyWiki[] }>('admin/policy/wikis'),
    ])
    setData(assistant)
    setWikis(wikiRows.wikis)
  }, [api])
  useEffect(() => {
    void reload().catch(() => setMessage(t.failed))
  }, [reload])
  const savedWikiId = String(data?.value.policy_wiki_id ?? '')
  const [viewedWikiId, setViewedWikiId] = useState('')
  useEffect(() => {
    setViewedWikiId(
      (current) => current || (wikis.some((wiki) => wiki.id === savedWikiId) ? savedWikiId : ''),
    )
  }, [savedWikiId, wikis])
  const selectedWikiId = wikis.some((wiki) => wiki.id === viewedWikiId) ? viewedWikiId : ''
  useEffect(() => {
    let isActive = true
    setSourceResult(null)
    setIsSourcesError(false)
    setIsSourcesLoading(!!selectedWikiId)
    if (selectedWikiId) {
      void api
        .get<WikiSourcesResult>(`admin/policy/wikis/${encodeURIComponent(selectedWikiId)}/sources`)
        .then((result) => {
          if (isActive) setSourceResult(result)
        })
        .catch(() => {
          if (isActive) setIsSourcesError(true)
        })
        .finally(() => {
          if (isActive) setIsSourcesLoading(false)
        })
    }
    return () => {
      isActive = false
    }
  }, [api, selectedWikiId, sourceRetry])
  async function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSaving) return
    const values = new FormData(event.currentTarget)
    const requestedWikiId = String(values.get('policy_wiki_id') ?? '')
    setIsSaving(true)
    setIsSaveError(false)
    setMessage(t.assistantSaving)
    try {
      await api.send('admin/assistant', 'PUT', {
        status: values.get('status'),
        value: {
          system_prompt: values.get('system_prompt'),
          policy_wiki_id: values.get('policy_wiki_id'),
        },
      })
      try {
        const saved = await api.get<ConfigValue>('admin/assistant')
        setData(saved)
        if (saved.value.policy_wiki_id === requestedWikiId) {
          setMessage(t.assistantSaved)
        } else {
          setMessage(t.assistantWikiMismatch)
          setIsSaveError(true)
        }
      } catch {
        setMessage(t.assistantSaveUnconfirmed)
        setIsSaveError(true)
      }
    } catch (error) {
      setMessage(`${t.assistantSaveFailed}${failureReason(error)}`)
      setIsSaveError(true)
    } finally {
      setIsSaving(false)
    }
  }
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{t.nav.assistant}</h2>
      {!data && <Feedback message={message} isError />}
      {data && (
        <form
          className={styles.formGrid}
          onSubmit={(event) => void onSave(event)}
          key={data.status}
          onChange={() => {
            if (!isSaving) setMessage('')
          }}
        >
          <label className={styles.field}>
            {t.assistantStatus}
            <select className={styles.select} name="status" defaultValue={data.status ?? 'draft'} disabled={isSaving}>
              {['draft', 'pending_review', 'published', 'disabled'].map((status) => (
                <option value={status} key={status}>
                  {t.statuses[status as keyof typeof t.statuses]}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.field}>
            <span>{t.assistantModel}</span>
            <p className={styles.muted}>{t.assistantModelManaged}</p>
          </div>
          <div className={`${styles.field} ${styles.fieldWide}`}>
            <label className={styles.field}>
              {t.policyWiki}
              <select
                className={styles.select}
                name="policy_wiki_id"
                value={selectedWikiId}
                onChange={(event) => setViewedWikiId(event.target.value)}
                required
                disabled={isSaving}
              >
                <option value="">{t.policySelectWiki}</option>
                {wikis.map((wiki) => (
                  <option key={wiki.id} value={wiki.id} disabled={wiki.buildStatus !== 'succeeded'}>
                    {wiki.name} · {t.policyBuildStatuses[wiki.buildStatus]}
                  </option>
                ))}
              </select>
            </label>
            {selectedWikiId && (
              <section className={styles.section} aria-live="polite">
                <div className={styles.caption}>
                  <strong>
                    {t.wikiSources}（{sourceResult?.sources.length ?? 0}）
                  </strong>
                  <span className={styles.muted}>{t.wikiSourcesHint}</span>
                </div>
                {isSourcesLoading ? (
                  <p>{t.loading}</p>
                ) : isSourcesError ? (
                  <div>
                    <p className={styles.errorLine}>{t.wikiSourcesFailed}</p>
                    <button
                      className={styles.buttonSecondary}
                      type="button"
                      onClick={() => setSourceRetry((value) => value + 1)}
                    >
                      {t.retry}
                    </button>
                  </div>
                ) : sourceResult?.record_status === 'unavailable' ? (
                  <p className={styles.muted}>{t.wikiRecordUnavailable}</p>
                ) : (
                  <div className={styles.list}>
                    {sourceResult?.sources.length ? (
                      sourceResult.sources.map((source) => (
                        <div className={styles.listItem} key={source.id}>
                          <div>
                            <strong>{source.fileName ?? t.wikiSourceNameUnavailable}</strong>
                            {source.status !== 'available' && (
                              <span className={styles.pill}>
                                {source.status === 'deleted'
                                  ? t.wikiSourceDeleted
                                  : t.wikiSourceUnavailable}
                              </span>
                            )}
                            <p className={styles.muted}>
                              {[
                                source.nodeName,
                                source.sizeBytes === null
                                  ? null
                                  : `${Math.ceil(source.sizeBytes / 1024)} KB`,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                            {!source.fileName && <p className={styles.muted}>{source.id}</p>}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className={styles.empty}>{t.empty}</div>
                    )}
                  </div>
                )}
              </section>
            )}
          </div>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            {t.assistantPrompt}
            <textarea
              className={styles.textarea}
              name="system_prompt"
              disabled={isSaving}
              defaultValue={String(data.value.system_prompt ?? '')}
            />
          </label>
          <div className={`${styles.inlineActions} ${styles.fieldWide}`}>
            <button className={styles.button} type="submit" disabled={isSaving}>{t.save}</button>
            <span role="status" aria-live="polite" className={isSaveError ? styles.errorLine : styles.statusLine}>{message}</span>
          </div>
        </form>
      )}
    </section>
  )
}

function LinksPage({ api }: { api: ParkApi }) {
  const [data, setData] = useState<PublicLinks | null>(null)
  const [message, setMessage] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const reload = useCallback(
    async () => setData(await api.get<PublicLinks>('admin/public-links')),
    [api],
  )
  useEffect(() => {
    void reload().catch(() => setMessage(t.failed))
  }, [reload])
  async function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    try {
      await api.send('admin/public-links', 'POST', {
        channel: values.get('channel'),
        label: values.get('label'),
        enabled: true,
      })
      form.reset()
      await reload()
      setMessage(t.saved)
    } catch {
      setMessage(t.saveFailed)
    }
  }
  async function onDelete(link: PublicLinks['links'][number]) {
    if (isDeleting || link.enabled) return
    const prompt = t.linkDeleteConfirm
      .replace('{label}', link.label)
      .replace('{channel}', link.channel)
    if (!window.confirm(prompt)) return
    setIsDeleting(true)
    try {
      await api.send(`admin/public-links/${encodeURIComponent(link.id)}`, 'DELETE')
      await reload()
      setMessage(t.linkDeleted)
    } catch (error) {
      if (error instanceof ParkApiError && error.status === 409) {
        setMessage(t.linkDeleteRequiresDisabled)
        await reload().catch(() => undefined)
      } else setMessage(t.linkDeleteFailed)
    } finally {
      setIsDeleting(false)
    }
  }
  async function onQr(channel: string) {
    try {
      const result = await api.get<{ data_url: string }>(
        `admin/public-links/${encodeURIComponent(channel)}/qr`,
      )
      const anchor = document.createElement('a')
      anchor.href = result.data_url
      anchor.download = `park-${channel}.png`
      anchor.click()
    } catch {
      setMessage(t.failed)
    }
  }
  async function onToggle(link: PublicLinks['links'][number]) {
    try {
      await api.send('admin/public-links', 'POST', {
        channel: link.channel,
        label: link.label,
        enabled: !link.enabled,
      })
      await reload()
      setMessage(t.saved)
    } catch {
      setMessage(t.saveFailed)
    }
  }
  return (
    <>
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>{t.publicUrl}</h2>
        <p>{data?.public_url ?? t.publicNotConfigured}</p>
        <div className={styles.list}>
          {data?.links.map((link) => {
            let linkUrl: URL | null = null
            try {
              linkUrl = data.public_url ? new URL(data.public_url) : null
            } catch {
              /* Show the configured value without a link. */
            }
            linkUrl?.searchParams.set('channel', link.channel)
            return (
              <div className={styles.listItem} key={link.id}>
                <strong>{link.label}</strong>
                <p>
                  {link.channel} · {link.enabled ? t.enabled : t.disabled}
                </p>
                <div className={styles.inlineActions}>
                  <button
                    className={styles.buttonSecondary}
                    type="button"
                    disabled={isDeleting}
                    onClick={() => void onToggle(link)}
                  >
                    {link.enabled ? t.disabled : t.enabled}
                  </button>
                  {!link.enabled && (
                    <button
                      className={styles.buttonDanger}
                      type="button"
                      disabled={isDeleting}
                      onClick={() => void onDelete(link)}
                    >
                      {t.documentDelete}
                    </button>
                  )}
                  {link.enabled && linkUrl && (
                    <>
                      <a href={linkUrl.toString()} target="_blank" rel="noreferrer">
                        {linkUrl.toString()}
                      </a>
                      <button
                        className={styles.buttonSecondary}
                        type="button"
                        onClick={() => void onQr(link.channel)}
                      >
                        {t.qrDownload}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>
      <section className={`${styles.panel} ${styles.sectionGap}`}>
        <h2 className={styles.panelTitle}>{t.create}</h2>
        <form className={styles.formGrid} onSubmit={(event) => void onSave(event)}>
          <label className={styles.field}>
            {t.channelCode}
            <input className={styles.input} name="channel" required pattern="[a-z0-9_-]+" />
          </label>
          <label className={styles.field}>
            {t.linkLabel}
            <input className={styles.input} name="label" required />
          </label>
          <button className={styles.button} type="submit">
            {t.save}
          </button>
        </form>
        <Feedback message={message} isError={message !== t.saved && message !== t.linkDeleted} />
      </section>
    </>
  )
}

const rateFields: Array<[string, string]> = [
  ['message_max_length', t.rateMessageLength],
  ['session_message_max', t.rateSessionMessages],
  ['session_token_budget', t.rateTokenBudget],
  ['concurrent_max', t.rateConcurrent],
  ['box_per_minute', t.rateBox],
  ['ip_per_minute', t.rateIp],
  ['subnet_per_minute', t.rateSubnet],
]

function RateLimitsPage({ api }: { api: ParkApi }) {
  const [data, setData] = useState<ConfigValue | null>(null)
  const [message, setMessage] = useState('')
  const reload = useCallback(
    async () => setData(await api.get<ConfigValue>('admin/rate-limits')),
    [api],
  )
  useEffect(() => {
    void reload().catch(() => setMessage(t.failed))
  }, [reload])
  async function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const value: Record<string, unknown> = {}
    for (const [key] of rateFields) value[key] = Number(values.get(key))
    value.blacklist_ips = String(values.get('blacklist_ips') ?? '')
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
    value.captcha_enabled = values.get('captcha_enabled') === 'on'
    value.automated_traffic_detection = values.get('automated_traffic_detection') === 'on'
    try {
      await api.send('admin/rate-limits', 'PUT', { value })
      await reload()
      setMessage(t.saved)
    } catch {
      setMessage(t.saveFailed)
    }
  }
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{t.nav.rateLimits}</h2>
      {data && (
        <form className={styles.formGrid} onSubmit={(event) => void onSave(event)}>
          {rateFields.map(([key, label]) => (
            <label className={styles.field} key={key}>
              {label}
              <input
                className={styles.input}
                type="number"
                min="1"
                name={key}
                defaultValue={Number(data.value[key] ?? 0) || ''}
                required
              />
            </label>
          ))}
          <label className={`${styles.field} ${styles.fieldWide}`}>
            {t.blacklist}
            <textarea
              className={styles.textarea}
              name="blacklist_ips"
              defaultValue={
                Array.isArray(data.value.blacklist_ips) ? data.value.blacklist_ips.join('\n') : ''
              }
            />
          </label>
          <label className={styles.field}>
            {t.automatedTrafficDetection}
            <input
              type="checkbox"
              name="automated_traffic_detection"
              defaultChecked={data.value.automated_traffic_detection !== false}
            />
          </label>
          <label className={styles.field}>
            {t.captchaEnabled}
            <input
              type="checkbox"
              name="captcha_enabled"
              defaultChecked={data.value.captcha_enabled === true}
            />
          </label>
          <button className={styles.button} type="submit">
            {t.save}
          </button>
        </form>
      )}
      <Feedback message={message} isError={message !== t.saved} />
    </section>
  )
}

function AuditPage({ api }: { api: ParkApi }) {
  const [rows, setRows] = useState<AuditEvent[]>([])
  const [redaction, setRedaction] = useState<ConfigValue | null>(null)
  const [message, setMessage] = useState('')
  const reload = useCallback(async () => {
    const [events, settings] = await Promise.all([
      api.get<AuditEvent[]>('admin/audit-events'),
      api.get<ConfigValue>('admin/redaction'),
    ])
    setRows(events)
    setRedaction(settings)
  }, [api])
  useEffect(() => {
    void reload().catch(() => setMessage(t.failed))
  }, [reload])
  async function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const extraTerms = String(values.get('extra_terms') ?? '')
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
    try {
      await api.send('admin/redaction', 'PUT', {
        value: {
          extra_terms: extraTerms,
          summary_max_length: Number(values.get('summary_max_length')),
        },
      })
      await reload()
      setMessage(t.saved)
    } catch {
      setMessage(t.saveFailed)
    }
  }
  return (
    <>
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>{t.redaction}</h2>
        {redaction && (
          <form className={styles.formGrid} onSubmit={(event) => void onSave(event)}>
            <label className={styles.field}>
              {t.summaryLength}
              <input
                className={styles.input}
                type="number"
                name="summary_max_length"
                min="100"
                max="4000"
                defaultValue={Number(redaction.value.summary_max_length)}
                required
              />
            </label>
            <label className={`${styles.field} ${styles.fieldWide}`}>
              {t.redactionExtra}
              <textarea
                className={styles.textarea}
                name="extra_terms"
                defaultValue={
                  Array.isArray(redaction.value.extra_terms)
                    ? redaction.value.extra_terms.join('\n')
                    : ''
                }
              />
            </label>
            <button className={styles.button} type="submit">
              {t.save}
            </button>
          </form>
        )}
        <Feedback message={message} isError={message !== t.saved} />
      </section>
      <section className={`${styles.panel} ${styles.sectionGap}`}>
        <h2 className={styles.panelTitle}>{t.auditEvent}</h2>
        {rows.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t.date}</th>
                  <th>{t.auditActor}</th>
                  <th>{t.actions}</th>
                  <th>{t.auditObject}</th>
                  <th>{t.status}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{localTime(Number(row.created_at))}</td>
                    <td>{row.actor_name ?? '—'}</td>
                    <td>{row.action_label}</td>
                    <td>{row.object_label}</td>
                    <td>{row.response_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.empty}>{t.empty}</div>
        )}
      </section>
    </>
  )
}

function OperationsPage({ api }: { api: ParkApi }) {
  const [data, setData] = useState<BoxStatus | null>(null)
  const [archive, setArchive] = useState('')
  const [upgradePackage, setUpgradePackage] = useState('')
  const [message, setMessage] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const reload = useCallback(
    async () => setData(await api.get<BoxStatus>('admin/operations')),
    [api],
  )
  useEffect(() => {
    void reload().catch(() => setMessage(t.failed))
  }, [reload])
  async function onAction(
    action: 'backup' | 'restore' | 'verify-upgrade' | 'upgrade' | 'rollback' | 'reindex',
  ) {
    const prompt =
      action === 'restore'
        ? t.confirmRestore
        : action === 'upgrade'
          ? t.confirmUpgrade
          : action === 'rollback'
            ? t.confirmRollback
            : null
    if (prompt && !window.confirm(prompt)) return
    setIsBusy(true)
    try {
      await api.send(`admin/operations/${action}`, 'POST', {
        name: action === 'restore' ? archive : upgradePackage,
      })
      await reload()
      setMessage(t.operationSuccess)
    } catch {
      setMessage(t.operationFailed)
    } finally {
      setIsBusy(false)
    }
  }
  if (!data) return <div className={styles.message}>{message || t.loading}</div>
  const gigabytes = (value: number) => `${(value / 1024 ** 3).toFixed(1)} GB`
  return (
    <>
      <Feedback message={message} isError={message === t.operationFailed} />
      <div className={styles.grid}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.operationStatus}</h2>
          <div className={styles.listItem}>
            <strong>{data.version ?? t.notConfigured}</strong>
            <p>Uptime · {data.uptime_seconds}s</p>
          </div>
          <h2 className={`${styles.panelTitle} ${styles.sectionGap}`}>{t.health}</h2>
          <div className={styles.list}>
            {data.health.length ? (
              data.health.map((item) => (
                <div className={styles.listItem} key={item.url}>
                  <strong>
                    {item.healthy ? t.healthy : t.unhealthy} · {item.status}
                  </strong>
                  <p>{item.url}</p>
                </div>
              ))
            ) : (
              <div className={styles.empty}>{t.notConfigured}</div>
            )}
          </div>
        </section>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t.resources}</h2>
          <div className={styles.listItem}>
            <strong>
              Disk · {gigabytes(data.disk.free_bytes)} / {gigabytes(data.disk.total_bytes)}
            </strong>
            <p>
              Memory · {gigabytes(data.memory.free_bytes)} / {gigabytes(data.memory.total_bytes)}
            </p>
          </div>
          <div className={`${styles.listItem} ${styles.sectionGap}`}>
            <strong>Model</strong>
            <pre>{JSON.stringify(data.model, null, 2)}</pre>
          </div>
        </section>
      </div>
      <div className={`${styles.grid} ${styles.sectionGap}`}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>
            {t.backup} / {t.restore}
          </h2>
          <div className={styles.inlineActions}>
            <button
              className={styles.button}
              disabled={isBusy || !data.available_actions.backup}
              onClick={() => void onAction('backup')}
            >
              {t.backup}
            </button>
            <select
              className={styles.select}
              value={archive}
              onChange={(event) => setArchive(event.target.value)}
            >
              <option value="">{t.archive}</option>
              {data.archives.map((name) => (
                <option value={name} key={name}>
                  {name}
                </option>
              ))}
            </select>
            <button
              className={styles.buttonDanger}
              disabled={isBusy || !archive || !data.available_actions.restore}
              onClick={() => void onAction('restore')}
            >
              {t.restore}
            </button>
          </div>
        </section>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>
            {t.upgrade} / {t.rollback}
          </h2>
          <div className={styles.inlineActions}>
            <select
              className={styles.select}
              value={upgradePackage}
              onChange={(event) => setUpgradePackage(event.target.value)}
            >
              <option value="">{t.upgradePackage}</option>
              {data.upgrades.map((name) => (
                <option value={name} key={name}>
                  {name}
                </option>
              ))}
            </select>
            <button
              className={styles.buttonSecondary}
              disabled={isBusy || !upgradePackage}
              onClick={() => void onAction('verify-upgrade')}
            >
              {t.verifySignature}
            </button>
            <button
              className={styles.button}
              disabled={isBusy || !upgradePackage || !data.available_actions.upgrade}
              onClick={() => void onAction('upgrade')}
            >
              {t.applyUpgrade}
            </button>
            <button
              className={styles.buttonDanger}
              disabled={isBusy || !data.available_actions.rollback}
              onClick={() => void onAction('rollback')}
            >
              {t.rollback}
            </button>
          </div>
        </section>
      </div>
      <section className={`${styles.panel} ${styles.sectionGap}`}>
        <h2 className={styles.panelTitle}>{t.reindex}</h2>
        <button
          className={styles.button}
          disabled={isBusy || !data.available_actions.reindex}
          onClick={() => void onAction('reindex')}
        >
          {t.run}
        </button>
      </section>
    </>
  )
}

export function OperatorPage({ id, api, onBrandSaved }: IOperatorPageProps) {
  if (id === 'policies') return <PoliciesPage api={api} />
  if (id === 'content')
    return <ContentSettingsPage api={api} onBrandSaved={onBrandSaved} />
  if (id === 'assistant') return <AssistantPage api={api} />
  if (id === 'publicLinks') return <LinksPage api={api} />
  if (id === 'rateLimits') return <RateLimitsPage api={api} />
  if (id === 'audit') return <AuditPage api={api} />
  return <OperationsPage api={api} />
}

interface IContentSettingsPageProps {
  api: ParkApi
  onBrandSaved: (brand: { display_name: string; logo_url: string | null }) => void
}

interface IOperatorPageProps extends IContentSettingsPageProps {
  id: PageId
}
