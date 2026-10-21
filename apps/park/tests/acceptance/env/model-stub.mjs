import http from 'node:http'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? '.')
const port = Number.parseInt(process.argv[3] ?? '4180', 10)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Model stub port must be an integer between 1 and 65535')
mkdirSync(root, { recursive: true })
const logPath = join(root, 'model-stub-calls.jsonl')
const apiKey = 'park-local-acceptance-key'

function messageText(message) {
  if (typeof message?.content === 'string') return message.content
  if (Array.isArray(message?.content)) return message.content.map(item => item?.text ?? '').join('\n')
  return ''
}

function isToolOutputText(value) {
  return /tool_(?:call|result)|bash-(?:stdout|stderr)|"(?:stdout|stderr|exit_code|matches|inquiry_id|proposed)"/i.test(value)
}

function latestQuestion(messages) {
  const text = [...messages].reverse()
    .filter(message => message?.role === 'user')
    .map(messageText)
    .find(value => value && !isToolOutputText(value)) ?? ''
  const lines = text.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
  return (lines.at(-1) ?? '企业入驻需要什么条件？').slice(0, 300)
}

function toolOutput(messages) {
  const latestUserIndex = messages.findLastIndex(message => message?.role === 'user' && !isToolOutputText(messageText(message)))
  return messages.slice(latestUserIndex + 1)
    .filter(message => message?.role === 'tool' || /bash-(?:stdout|stderr)|tool_result/i.test(messageText(message)))
    .map(messageText).join('\n')
}

function powerShellCall(command) {
  return {
    id: `call_${Date.now()}`,
    type: 'function',
    function: { name: 'PowerShell', arguments: JSON.stringify({ command }) },
  }
}

function parkToolCall(command, args) {
  const encodedArgs = Buffer.from(JSON.stringify(args), 'utf8').toString('base64')
  const program = `process.argv.push('park-tools.mjs','${command}',Buffer.from(process.env.PARK_ARGS_B64,'base64').toString('utf8'));import('./.nexus/sudocode/skills/park-consultation-tools/scripts/park-tools.mjs')`
  return powerShellCall(`$env:PARK_ARGS_B64='${encodedArgs}'; node -e "${program}"`)
}

function scriptedReply(body) {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const all = messages.map(messageText).join('\n')
  const output = toolOutput(messages)
  if (/Cannot find module|CommandNotFoundException|is not recognized as the name of a cmdlet|arguments must be valid JSON|park-tools: .* failed \(\d{3}\)/i.test(output)) {
    return { content: '验收工具执行失败，请检查 skill 脚本路径。', label: 'park-tool-error' }
  }
  if (/Wiki|WIKI\.md|wiki-builder/i.test(all) && !/PARK_PUBLIC|park-consultation-tools/.test(all)) {
    if (!output) {
      const command = "$source = (Get-ChildItem -LiteralPath input -Filter *.md | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw -Encoding utf8 }) -join \"`n`n\"; Set-Content -LiteralPath WIKI.md -Encoding utf8 -Value \"---`ntitle: 园区政策`ntype: index`n---`n园区入驻与服务政策索引。`n`n- [园区政策](chunk-001-policy.md)\"; Set-Content -LiteralPath chunk-001-policy.md -Encoding utf8 -Value (\"---`ntitle: 园区政策`ntype: chunk`ntopic: policy`n---`n\" + $source)"
      return { toolCall: powerShellCall(command), label: 'wiki-write' }
    }
    return { content: 'Wiki 已构建，生成 1 个 chunk。', label: 'wiki-done' }
  }

  const question = latestQuestion(messages)
  const answer = '根据园区政策资料，企业可咨询入驻条件、场地与算力服务，最终结果以园区审核为准。来源：chunk-001-policy.md 第 6 行。'
  if (!/matches|inquiry_id|proposed/.test(output)) {
    const searchQuery = /入驻/.test(question) ? '入驻' : /算力/.test(question) ? '算力' : question
    return { toolCall: parkToolCall('policy.search', { q: searchQuery }), label: 'policy-search' }
  }
  if (/matches/.test(output) && !/inquiry_id/.test(output)) {
    const args = { question, answer, intent: /\u5165\u9a7b|\u79df\u8d41|\u573a\u5730/.test(question) ? 'settlement_intent' : 'policy_inquiry', industry_tags: [] }
    return { toolCall: parkToolCall('inquiry.append', args), label: 'inquiry-append' }
  }
  if (/inquiry_id/.test(output) && !/proposed/.test(output) && /\u5165\u9a7b|\u79df\u8d41|\u573a\u5730|\u8865\u8d34/.test(question)) {
    const args = { industry_tags: [], suggested_action: '建议园区工作人员后续对接' }
    return { toolCall: parkToolCall('lead.propose', args), label: 'lead-propose' }
  }
  return { content: answer, label: 'park-answer' }
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

const server = http.createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${apiKey}`) return sendJson(res, 401, { error: { message: 'unauthorized' } })
  if (req.method === 'GET' && req.url === '/v1/models') return sendJson(res, 200, { object: 'list', data: [{ id: 'park-acceptance', object: 'model' }] })
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return sendJson(res, 404, { error: { message: 'not_found' } })
  let raw = ''
  for await (const chunk of req) raw += String(chunk)
  const body = JSON.parse(raw)
  const reply = scriptedReply(body)
  appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), label: reply.label, stream: body.stream === true, messages: body.messages, tools: body.tools })}\n`)
  const message = reply.toolCall
    ? { role: 'assistant', content: null, tool_calls: [reply.toolCall] }
    : { role: 'assistant', content: reply.content }
  const finishReason = reply.toolCall ? 'tool_calls' : 'stop'
  if (body.stream !== true) return sendJson(res, 200, { id: `chatcmpl-${Date.now()}`, object: 'chat.completion', model: 'park-acceptance', choices: [{ index: 0, message, finish_reason: finishReason }] })
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' })
  if (reply.toolCall) {
    res.write(`data: ${JSON.stringify({ id: `chatcmpl-${Date.now()}`, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, ...reply.toolCall }] }, finish_reason: null }] })}\n\n`)
  } else {
    res.write(`data: ${JSON.stringify({ id: `chatcmpl-${Date.now()}`, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: reply.content }, finish_reason: null }] })}\n\n`)
  }
  res.write(`data: ${JSON.stringify({ id: `chatcmpl-${Date.now()}`, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`)
  res.end('data: [DONE]\n\n')
})

server.listen(port, '127.0.0.1', () => process.stdout.write(`PARK_MODEL_STUB_READY:${port}\n`))
