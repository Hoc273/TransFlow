// Route matching + response builders for the TransFlow mock API.
//
// connect-style middleware for the Vite dev server. It intercepts every
// request under /api and answers with in-memory data so the frontend can run
// fully standalone. State is held in the data module between requests.

const fs = require('fs')
const path = require('path')
const d = require('./data.cjs')

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function sendNoContent(res) {
  res.statusCode = 204
  res.end()
}

function readBody(req, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > maxBytes) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function readJson(req) {
  const buf = await readBody(req)
  if (!buf.length) return {}
  try {
    return JSON.parse(buf.toString('utf8'))
  } catch {
    return {}
  }
}

const CURRENT_UTC = new Date().toISOString()

// Video streaming helper for Media Studio (supports HTTP 206 Partial Content Range requests)
function serveVideo(ctx) {
  const videoCandidates = [
    'C:\\Users\\nguye\\Videos\\ATTT_qua_Mật_mã_học.mp4',
    path.resolve(__dirname, '../public/videos/ATTT_qua_Mật_mã_học.mp4'),
    path.resolve(__dirname, '../public/sample-video.mp4'),
  ]
  let videoPath = null
  for (const cand of videoCandidates) {
    try {
      if (fs.existsSync(cand)) {
        videoPath = cand
        break
      }
    } catch {
      // ignore
    }
  }

  if (!videoPath) {
    ctx.res.statusCode = 404
    ctx.res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    ctx.res.end('Video not found')
    return
  }

  const stat = fs.statSync(videoPath)
  const fileSize = stat.size
  const range = ctx.req.headers['range'] || ctx.req.headers['Range']

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
    const chunkSize = end - start + 1
    const file = fs.createReadStream(videoPath, { start, end })

    ctx.res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
      'Cache-Control': 'no-cache',
    })
    file.pipe(ctx.res)
  } else {
    ctx.res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    })
    fs.createReadStream(videoPath).pipe(ctx.res)
  }
}

function formatSrtTime(ms = 0) {
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0')
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0')
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')
  const mil = String(ms % 1000).padStart(3, '0')
  return `${h}:${m}:${s},${mil}`
}

function formatVttTime(ms = 0) {
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0')
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0')
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')
  const mil = String(ms % 1000).padStart(3, '0')
  return `${h}:${m}:${s}.${mil}`
}

// ---------------------------------------------------------------------------
// response factories
// ---------------------------------------------------------------------------
function makeAuthResponse(user) {
  const { password, ...safe } = user
  return {
    accessToken: `mock.jwt.${user.id}`,
    refreshToken: `mock.refresh.${user.id}`,
    user: safe,
  }
}

const CUE_SCRIPTS = [
  { source: 'Chào mừng các bạn đến với bài giảng An toàn thông tin qua Mật mã học.', target: 'Welcome to the lecture on Information Security through Cryptography.' },
  { source: 'Mật mã học đóng vai trò là hòn đá tảng bảo vệ dữ liệu trong kỷ nguyên số.', target: 'Cryptography serves as the cornerstone of data protection in the digital era.' },
  { source: 'Ba mục tiêu then chốt của an toàn thông tin gồm: tính bảo mật, toàn vẹn và khả dụng (CIA triad).', target: 'The three core goals of information security are Confidentiality, Integrity, and Availability (the CIA triad).' },
  { source: 'Chúng ta phân biệt hai nhánh chính: mật mã khóa đối xứng và mật mã khóa công khai.', target: 'We distinguish two major branches: symmetric key cryptography and public key cryptography.' },
  { source: 'Thuật toán AES và DES là những ví dụ điển hình của hệ mật mã đối xứng.', target: 'AES and DES algorithms are prime examples of symmetric cryptosystems.' },
]

function buildSegment(seq) {
  const script = CUE_SCRIPTS[seq - 1] ?? { source: `Mật mã học dòng ${seq}`, target: `Cryptography cue ${seq}` }
  return {
    id: d.uuid('seg'),
    seq,
    sourceText: script.source,
    targetText: script.target,
    status: 'TRANSLATED',
    tmScore: null,
    qaIssues: [],
    startMs: (seq - 1) * 7000,
    endMs: (seq - 1) * 7000 + 6500,
  }
}

function makeJobDetail(segments) {
  return {
    id: 'jtxt_1',
    documentId: 'd_1',
    targetLang: 'en',
    status: 'COMPLETED',
    providerUsed: 'mock-provider',
    modelUsed: 'gpt-4o-mini',
    segments,
  }
}

function makeStage(name, order, status, extra = {}) {
  return {
    id: d.uuid('stage'),
    stageName: name,
    stageOrder: order,
    status,
    progressPercent: status === 'COMPLETED' ? 100 : status === 'PROCESSING' ? 45 : 0,
    attemptCount: 1,
    errorMessage: null,
    startedAt: CURRENT_UTC,
    completedAt: status === 'COMPLETED' ? CURRENT_UTC : null,
    ...extra,
  }
}

function makeRenderConfig(jobId) {
  const job = d.mediaJobs.find((j) => j.id === jobId)
  return {
    subtitleMode: job?.subtitleMode || 'SOFT_SUB',
    subtitlePosition: 'BOTTOM',
    verticalOffsetPercent: 0,
    backgroundBox: false,
    confirmed: job?.workflowMode === 'MANUAL' ? false : true,
    sourceVideoUrl: '/api/media/sample-video',
    sourceVideoUrlExpiresInSeconds: 7200,
    presentation: {
      schemaVersion: 2,
      outputAspectRatio: job?.aspectRatio || '16:9',
      keepOriginalAudio: Boolean(job?.keepOriginalAudio),
      subtitle: {
        schemaVersion: 2,
        displayMode: 'SENTENCE',
        maxCharactersPerCue: 42,
        position: 'BOTTOM',
        typography: {
          fontSize: 44,
          bold: true,
          outlineWidth: 2,
          outlineColor: '#000000',
        },
      },
      audio: {
        schemaVersion: 1,
        sourceGainDb: 0,
        ttsGainDb: 0,
        ducking: false,
      },
      coverLayers: [
        {
          id: 'cov_1',
          anchor: 'TOP_RIGHT',
          type: 'BLUR',
          blurRadius: 16,
          geometry: {
            xPercent: 82,
            yPercent: 8,
            widthPercent: 18,
            heightPercent: 7,
          },
        },
      ],
    },
    backgroundColor: null,
    textColor: null,
    effective: { boxMode: false, ownedByStyle: false, resolvedLinePercent: 88, deadControls: [] },
  }
}

function pageJson(ctx, items) {
  const page = Number(ctx.query.get('page') || 0)
  const size = Number(ctx.query.get('size') || 20)
  const total = items.length
  const start = page * size
  const content = items.slice(start, start + size)
  sendJson(ctx.res, 200, { content, page, size, totalElements: total, totalPages: Math.ceil(total / size) })
}

// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------
function stripPrefix(path) {
  return path.startsWith('/api') ? path.slice(4) : path
}

function parseUrl(req) {
  const rawUrl = req.url || '/'
  const qIndex = rawUrl.indexOf('?')
  const path = stripPrefix(qIndex >= 0 ? rawUrl.slice(0, qIndex) : rawUrl)
  const qs = qIndex >= 0 ? rawUrl.slice(qIndex + 1) : ''
  return { path, query: new URLSearchParams(qs) }
}

function route(pathTemplate, method, handler) {
  const segments = pathTemplate.split('/').filter(Boolean)
  const escaped = segments.map((seg) =>
    seg.startsWith(':') ? '([^/]+)' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  )
  const regex = new RegExp(`^/${escaped.join('/')}/?$`)
  return {
    regex,
    method,
    handler,
    paramNames: segments.filter((s) => s.startsWith(':')).map((s) => s.slice(1)),
  }
}

function match(routes, path, method) {
  for (const r of routes) {
    const m = r.regex.exec(path)
    if (!m) continue
    if (r.method && r.method !== method) continue
    const params = {}
    r.paramNames.forEach((name, i) => {
      params[name] = m[i + 1]
    })
    return { params, handler: r.handler }
  }
  return null
}

function getCurrentUser(req) {
  const auth = req && req.headers && (req.headers['authorization'] || req.headers['Authorization'])
  if (auth && typeof auth === 'string') {
    const match = auth.match(/mock\.jwt\.(u_\w+)/)
    if (match) {
      const found = d.users.find((u) => u.id === match[1])
      if (found) return found
    }
  }
  return d.users[0]
}

function buildRoutes() {
  const R = []
  const r = (t, m, h) => R.push(route(t, m, h))
  const rBoth = (t1, t2, m, h) => {
    R.push(route(t1, m, h))
    R.push(route(t2, m, h))
  }
  const json = (body) => (ctx) => sendJson(ctx.res, 200, body)
  const created = (body) => (ctx) => sendJson(ctx.res, 201, body)

  // ---- Auth ----
  r('/auth/login', 'POST', async (ctx) => {
    const body = await readJson(ctx.req)
    const inputEmail = (body?.email || '').trim().toLowerCase()
    let user = d.users.find((u) => u.email.toLowerCase() === inputEmail)
    if (!user) {
      // Default to normal user (non-admin) unless email is admin
      user = {
        id: d.uuid('u'),
        email: body?.email || 'user@transflow.io',
        fullName: body?.email ? body.email.split('@')[0] : 'Standard User',
        isPlatformAdmin: false,
        password: body?.password || 'password123',
      }
      d.users.push(user)
      if (d.membersByWs && d.membersByWs['ws_1']) {
        d.membersByWs['ws_1'].push({
          memberId: d.uuid('m'),
          userId: user.id,
          email: user.email,
          fullName: user.fullName,
          role: 'ADMIN',
        })
      }
    }
    sendJson(ctx.res, 200, makeAuthResponse(user))
  })
  r('/auth/register', 'POST', async (ctx) => {
    const body = await readJson(ctx.req)
    const user = {
      id: d.uuid('u'),
      email: body.email || 'new@transflow.io',
      fullName: body.fullName || 'New User',
      isPlatformAdmin: false,
      password: body.password,
    }
    d.users.push(user)
    if (d.membersByWs && d.membersByWs['ws_1']) {
      d.membersByWs['ws_1'].push({
        memberId: d.uuid('m'),
        userId: user.id,
        email: user.email,
        fullName: user.fullName,
        role: 'ADMIN',
      })
    }
    sendJson(ctx.res, 201, makeAuthResponse(user))
  })
  r('/auth/me', 'GET', (ctx) => {
    const user = getCurrentUser(ctx.req)
    const { password, ...safe } = user
    sendJson(ctx.res, 200, safe)
  })
  r('/auth/google/exchange', 'POST', (ctx) => sendJson(ctx.res, 200, makeAuthResponse(getCurrentUser(ctx.req))))
  r('/auth/refresh', 'POST', async (ctx) => {
    const body = await readJson(ctx.req)
    const match = body.refreshToken && body.refreshToken.match(/mock\.refresh\.(u_\w+)/)
    const user = (match && d.users.find((u) => u.id === match[1])) || getCurrentUser(ctx.req)
    sendJson(ctx.res, 200, makeAuthResponse(user))
  })
  r('/auth/google/start', 'GET', (ctx) => sendJson(ctx.res, 200, { url: '/auth/google/done?code=mock' }))

  // ---- Workspaces ----
  r('/workspaces', 'GET', (ctx) => {
    const user = getCurrentUser(ctx.req)
    const list = d.workspaces
      .filter((ws) => {
        const members = d.membersByWs[ws.id] || []
        return members.some((m) => m.userId === user.id)
      })
      .map((ws) => {
        const members = d.membersByWs[ws.id] || []
        const mem = members.find((m) => m.userId === user.id)
        return {
          ...ws,
          myRole: mem ? mem.role : 'CLIENT',
        }
      })
    sendJson(ctx.res, 200, list)
  })
  r('/workspaces', 'POST', async (ctx) => {
    const user = getCurrentUser(ctx.req)
    const body = await readJson(ctx.req)
    const ws = {
      id: d.uuid('ws'),
      name: body.name || 'Untitled',
      slug: (body.name || 'untitled').toLowerCase().replace(/\s+/g, '-'),
      myRole: 'ADMIN',
    }
    d.workspaces.push(ws)
    d.membersByWs[ws.id] = [
      { memberId: 'm_' + ws.id + '_1', userId: user.id, email: user.email, fullName: user.fullName, role: 'ADMIN' },
    ]
    sendJson(ctx.res, 201, ws)
  })
  r('/workspaces/:workspaceId', 'GET', (ctx) => {
    const user = getCurrentUser(ctx.req)
    const ws = d.workspaces.find((w) => w.id === ctx.params.workspaceId)
    if (!ws) return sendJson(ctx.res, 404, { errorCode: 'NOT_FOUND', message: 'Workspace not found' })
    const members = d.membersByWs[ws.id] || []
    const mem = members.find((m) => m.userId === user.id)
    sendJson(ctx.res, 200, {
      ...ws,
      myRole: mem ? mem.role : 'CLIENT',
    })
  })

  // ---- Members ----
  r('/workspaces/:workspaceId/members', 'GET', (ctx) =>
    sendJson(ctx.res, 200, d.membersByWs[ctx.params.workspaceId] ?? []),
  )
  r('/workspaces/:workspaceId/members', 'POST', async (ctx) => {
    const body = await readJson(ctx.req)
    const member = {
      memberId: d.uuid('m'),
      userId: body.userId ?? d.uuid('u'),
      email: body.email || 'member@transflow.io',
      fullName: body.fullName || 'Member',
      role: body.role || 'TRANSLATOR',
    }
    ;(d.membersByWs[ctx.params.workspaceId] ??= []).push(member)
    sendJson(ctx.res, 201, member)
  })
  r('/workspaces/:workspaceId/members/:memberId', 'PUT', async (ctx) => {
    const body = await readJson(ctx.req)
    const list = d.membersByWs[ctx.params.workspaceId] ?? []
    const member = list.find((m) => m.memberId === ctx.params.memberId)
    if (member) member.role = body.role ?? member.role
    sendJson(ctx.res, 200, member ?? { errorCode: 'NOT_FOUND', message: 'Member not found' })
  })
  r('/workspaces/:workspaceId/members/:memberId', 'DELETE', (ctx) => {
    const list = d.membersByWs[ctx.params.workspaceId] ?? []
    const i = list.findIndex((m) => m.memberId === ctx.params.memberId)
    if (i >= 0) list.splice(i, 1)
    sendNoContent(ctx.res)
  })

  // ---- Projects ----
  r('/workspaces/:workspaceId/projects', 'GET', (ctx) => {
    const list = d.projects.map((p) => {
      const docList = d.documents.filter((doc) => doc.projectId === p.id)
      const mediaList = d.mediaJobs.filter((mj) => mj.projectId === p.id)
      const hasProcessing = docList.some((doc) => doc.status === 'PROCESSING') || mediaList.some((mj) => mj.status === 'PROCESSING')
      return {
        ...p,
        documentCount: docList.length,
        mediaCount: mediaList.length,
        progressPercent: docList.length > 0 ? (hasProcessing ? 70 : 100) : 0,
      }
    })
    sendJson(ctx.res, 200, list)
  })
  r('/workspaces/:workspaceId/projects/:projectId', 'GET', (ctx) => {
    const p = d.projects.find((x) => x.id === ctx.params.projectId)
    sendJson(ctx.res, p ? 200 : 404, p ?? { errorCode: 'NOT_FOUND', message: 'Project not found' })
  })
  r('/workspaces/:workspaceId/projects', 'POST', async (ctx) => {
    const body = await readJson(ctx.req)
    const p = {
      id: d.uuid('p'),
      name: body.name || 'Untitled',
      sourceLang: body.sourceLang || 'en',
      defaultGlossaryId: body.defaultGlossaryId ?? null,
      tmEnabled: body.tmEnabled ?? true,
      domain: body.domain ?? null,
      tone: body.tone ?? null,
    }
    d.projects.push(p)
    sendJson(ctx.res, 201, p)
  })

  // ---- Documents ----
  r('/workspaces/:workspaceId/projects/:projectId/documents', 'GET', (ctx) =>
    sendJson(ctx.res, 200, d.documents.filter((doc) => doc.projectId === ctx.params.projectId)),
  )
  r('/workspaces/:workspaceId/documents/:documentId', 'GET', (ctx) => {
    const doc = d.documents.find((x) => x.id === ctx.params.documentId)
    sendJson(ctx.res, doc ? 200 : 404, doc ?? { errorCode: 'NOT_FOUND', message: 'Document not found' })
  })
  r('/workspaces/:workspaceId/projects/:projectId/documents', 'POST', async (ctx) => {
    const body = await readJson(ctx.req)
    const doc = {
      id: d.uuid('d'),
      projectId: ctx.params.projectId,
      name: body.name || 'Untitled',
      sourceLang: body.sourceLang || 'en',
      status: 'PENDING',
      origin: 'MANUAL',
      createdAt: CURRENT_UTC,
    }
    d.documents.push(doc)
    sendJson(ctx.res, 201, doc)
  })
  r('/workspaces/:workspaceId/projects/:projectId/documents/upload', 'POST', async (ctx) => {
    await readBody(ctx.req, 50 * 1024 * 1024)
    const doc = {
      id: d.uuid('d'),
      projectId: ctx.params.projectId,
      name: 'uploaded-document.txt',
      sourceLang: 'en',
      status: 'PENDING',
      origin: 'UPLOAD',
      createdAt: CURRENT_UTC,
    }
    d.documents.push(doc)
    sendJson(ctx.res, 201, doc)
  })

  // ---- Batches ----
  r('/workspaces/:workspaceId/batches', 'GET', json(d.batches))
  r('/workspaces/:workspaceId/batches', 'POST', async (ctx) => {
    await readBody(ctx.req, 50 * 1024 * 1024)
    const batch = {
      id: d.uuid('b'),
      projectId: 'p_1',
      name: 'New Batch',
      status: 'PROCESSING',
      totalDocuments: 2,
      completedDocuments: 0,
      failedDocuments: 0,
      totalSizeBytes: 96000000,
      createdAt: CURRENT_UTC,
      updatedAt: CURRENT_UTC,
    }
    d.batches.unshift(batch)
    sendJson(ctx.res, 201, {
      batchId: batch.id,
      documents: [
        { documentId: 'doc_a', fileName: 'file-a.mp4', jobIds: ['mj_new_1'] },
        { documentId: 'doc_b', fileName: 'file-b.mp4', jobIds: ['mj_new_2'] },
      ],
    })
  })
  r('/workspaces/:workspaceId/batches/:batchId', 'GET', (ctx) => {
    const detail = d.batchDetails[ctx.params.batchId] || d.batchDetails.b_1
    sendJson(ctx.res, 200, detail)
  })
  r('/workspaces/:workspaceId/batches/:batchId/documents/:documentId/retry', 'POST', (ctx) =>
    sendJson(ctx.res, 200, { batchId: ctx.params.batchId, documentId: ctx.params.documentId, retriedJobIds: ['mj_1'], message: 'Retried' }),
  )

  // ---- Text jobs ----
  r('/workspaces/:workspaceId/jobs', 'GET', (ctx) => {
    sendJson(ctx.res, 200, d.textJobs)
  })
  r('/workspaces/:workspaceId/documents/:documentId/jobs', 'GET', (ctx) => {
    const list = d.textJobs.filter((j) => j.documentId === ctx.params.documentId)
    sendJson(ctx.res, 200, list.length > 0 ? list : d.textJobs)
  })
  r('/workspaces/:workspaceId/jobs/:jobId', 'GET', (ctx) => {
    const job = d.textJobs.find((j) => j.id === ctx.params.jobId)
    if (job) return sendJson(ctx.res, 200, job)
    const list = d.mediaSegmentsByJob[ctx.params.jobId] || d.job1Segments
    sendJson(ctx.res, 200, {
      id: ctx.params.jobId,
      documentId: 'd_1',
      targetLang: ctx.params.jobId === 'jtxt_2' ? 'ja' : ctx.params.jobId === 'jtxt_3' ? 'vi' : 'en',
      status: 'COMPLETED',
      providerUsed: 'OpenAI Compatible',
      modelUsed: 'gpt-4o-mini',
      segments: list,
    })
  })
  r('/workspaces/:workspaceId/documents/:documentId/jobs', 'POST', async (ctx) => {
    const body = await readJson(ctx.req)
    const newJob = {
      id: d.uuid('jtxt'),
      documentId: ctx.params.documentId,
      targetLang: body.targetLang || 'en',
      status: 'PROCESSING',
      providerUsed: 'OpenAI Compatible',
      modelUsed: 'gpt-4o-mini',
      createdAt: d.now(),
      segments: [1, 2, 3, 4, 5].map(buildSegment),
    }
    d.textJobs.unshift(newJob)
    sendJson(ctx.res, 201, newJob)
  })

  // ---- Segments & QA ----
  r('/workspaces/:workspaceId/segments/:segmentId', 'PATCH', async (ctx) => {
    const body = await readJson(ctx.req)
    let seg = null
    for (const j of d.textJobs) {
      seg = (j.segments || []).find((s) => s.id === ctx.params.segmentId)
      if (seg) break
    }
    if (!seg) seg = d.job1Segments.find((s) => s.id === ctx.params.segmentId) ?? buildSegment(1)
    if (body.targetText !== undefined) seg.targetText = body.targetText
    if (body.startMs !== undefined) seg.startMs = body.startMs
    if (body.endMs !== undefined) seg.endMs = body.endMs
    sendJson(ctx.res, 200, seg)
  })
  r('/workspaces/:workspaceId/segments/:segmentId/approve', 'POST', (ctx) => {
    let seg = null
    for (const j of d.textJobs) {
      seg = (j.segments || []).find((s) => s.id === ctx.params.segmentId)
      if (seg) break
    }
    if (!seg) seg = d.job1Segments.find((s) => s.id === ctx.params.segmentId) ?? buildSegment(1)
    seg.status = 'APPROVED'
    ;(seg.qaIssues ?? []).forEach((qi) => { qi.resolved = true })
    sendJson(ctx.res, 200, seg)
  })
  r('/workspaces/:workspaceId/segments/:segmentId/qa', 'POST', json({ ok: true }))
  r('/workspaces/:workspaceId/segments/:segmentId/history', 'GET', (ctx) => {
    sendJson(ctx.res, 200, [
      { id: 'h_1', actorType: 'AI', actorUserId: null, actorName: 'gpt-4o-mini', action: 'TRANSLATE', oldValue: null, newValue: 'Dịch máy khởi tạo', createdAt: d.pastHours(2) },
      { id: 'h_2', actorType: 'HUMAN', actorUserId: 'u_translator', actorName: 'Lan Nguyen', action: 'EDIT', oldValue: 'Dịch máy khởi tạo', newValue: 'Bản dịch hiệu đính chuẩn thuật ngữ', createdAt: d.pastMinutes(30) },
      { id: 'h_3', actorType: 'AI', actorUserId: null, actorName: 'QA Engine', action: 'QA_CHECK', oldValue: null, newValue: 'Đạt kiểm tra CPS và thuật ngữ', createdAt: d.pastMinutes(15) },
    ])
  })
  r('/workspaces/:workspaceId/qa-issues/:issueId/resolve', 'POST', (ctx) => {
    const allSegments = [...d.job1Segments, ...(d.textJobs.flatMap((j) => j.segments || []))]
    for (const seg of allSegments) {
      const qi = (seg.qaIssues ?? []).find((i) => i.id === ctx.params.issueId)
      if (qi) {
        qi.resolved = true
        break
      }
    }
    sendNoContent(ctx.res)
  })
  r('/workspaces/:workspaceId/qa-issues/:issueId/override', 'POST', async (ctx) => {
    const body = await readJson(ctx.req)
    const allSegments = [...d.job1Segments, ...(d.textJobs.flatMap((j) => j.segments || []))]
    for (const seg of allSegments) {
      const qi = (seg.qaIssues ?? []).find((i) => i.id === ctx.params.issueId)
      if (qi) {
        qi.resolved = true
        qi.overrides = [{ blockingAction: 'BLOCK_EXPORT', reason: body.reason || 'User manual override' }]
        break
      }
    }
    sendNoContent(ctx.res)
  })

  // ---- Glossary ----
  r('/workspaces/:workspaceId/glossaries', 'GET', json(d.glossaries))
  r('/workspaces/:workspaceId/glossaries', 'POST', async (ctx) => {
    const body = await readJson(ctx.req)
    const g = { id: d.uuid('g'), name: body.name || 'Untitled', description: body.description ?? null, termCount: 0, updatedAt: CURRENT_UTC }
    d.glossaries.push(g)
    d.glossaryTerms[g.id] = []
    sendJson(ctx.res, 201, g)
  })
  r('/workspaces/:workspaceId/glossaries/:glossaryId', 'GET', (ctx) => {
    const terms = d.glossaryTerms[ctx.params.glossaryId] ?? []
    sendJson(ctx.res, 200, { id: ctx.params.glossaryId, name: 'Tech Terms EN-VI', description: null, updatedAt: CURRENT_UTC, terms })
  })
  r('/workspaces/:workspaceId/glossaries/:glossaryId', 'PUT', async (ctx) => {
    const body = await readJson(ctx.req)
    sendJson(ctx.res, 200, { id: ctx.params.glossaryId, name: body.name || 'Untitled', description: body.description ?? null, termCount: d.glossaryTerms[ctx.params.glossaryId]?.length ?? 0, updatedAt: CURRENT_UTC })
  })
  r('/workspaces/:workspaceId/glossaries/:glossaryId', 'DELETE', (ctx) => sendNoContent(ctx.res))
  r('/workspaces/:workspaceId/glossaries/:glossaryId/terms', 'GET', (ctx) =>
    sendJson(ctx.res, 200, d.glossaryTerms[ctx.params.glossaryId] ?? []),
  )
  r('/workspaces/:workspaceId/glossaries/:glossaryId/terms', 'POST', async (ctx) => {
    const body = await readJson(ctx.req)
    const added = (body.terms ?? []).map((t) => ({
      id: d.uuid('t'),
      sourceTerm: t.sourceTerm,
      targetTerm: t.targetTerm,
      caseSensitive: !!t.caseSensitive,
      partOfSpeech: t.partOfSpeech ?? null,
      note: t.note ?? null,
      updatedAt: CURRENT_UTC,
    }))
    ;(d.glossaryTerms[ctx.params.glossaryId] ??= []).push(...added)
    sendJson(ctx.res, 201, { added: added.length, skipped: 0, errors: [] })
  })
  r('/workspaces/:workspaceId/glossaries/:glossaryId/terms/:termId', 'PUT', async (ctx) => {
    const body = await readJson(ctx.req)
    const list = d.glossaryTerms[ctx.params.glossaryId] ?? []
    const term = list.find((t) => t.id === ctx.params.termId)
    if (term) { term.sourceTerm = body.sourceTerm ?? term.sourceTerm; term.targetTerm = body.targetTerm ?? term.targetTerm }
    sendJson(ctx.res, 200, term ?? buildTerm(ctx.params.termId))
  })
  r('/workspaces/:workspaceId/glossaries/:glossaryId/terms/:termId', 'DELETE', (ctx) => {
    const list = d.glossaryTerms[ctx.params.glossaryId] ?? []
    const i = list.findIndex((t) => t.id === ctx.params.termId)
    if (i >= 0) list.splice(i, 1)
    sendNoContent(ctx.res)
  })
  r('/workspaces/:workspaceId/glossaries/:glossaryId/import', 'POST', async (ctx) => {
    await readBody(ctx.req, 5 * 1024 * 1024)
    sendJson(ctx.res, 200, { added: 5, skipped: 1, errors: ['Line 7: invalid'] })
  })

  // ---- TM ----
  r('/workspaces/:workspaceId/tm', 'GET', (ctx) =>
    sendJson(ctx.res, 200, { lookup: null, entries: d.tmEntries, total: d.tmEntries.length }),
  )
  r('/workspaces/:workspaceId/tm/:id', 'DELETE', (ctx) => {
    const i = d.tmEntries.findIndex((e) => e.id === ctx.params.id)
    if (i >= 0) d.tmEntries.splice(i, 1)
    sendNoContent(ctx.res)
  })

  // ---- Providers (both /workspaces/:id/providers and /users/me/providers) ----
  r('/users/me/providers', 'GET', json(d.providers))
  r('/users/me/providers', 'POST', async (ctx) => {
    const body = await readJson(ctx.req)
    const p = {
      id: d.uuid('prov'),
      displayName: body.displayName || 'Provider',
      protocol: body.protocol || 'openai_compatible',
      capabilities: body.capabilities ?? [],
      defaultFor: body.defaultForCapabilities ?? [],
      baseUrl: body.baseUrl || '',
      apiKeyHint: body.apiKey ? 'sk-...mock' : null,
      defaultModel: body.defaultModel || '',
      enabled: body.enabled ?? true,
      temperature: body.temperature ?? null,
    }
    d.providers.push(p)
    sendJson(ctx.res, 201, p)
  })
  r('/users/me/providers/:providerId', 'GET', (ctx) => {
    const p = d.providers.find((x) => x.id === ctx.params.providerId)
    sendJson(ctx.res, p ? 200 : 404, p ?? { errorCode: 'NOT_FOUND', message: 'Provider not found' })
  })
  r('/users/me/providers/:providerId', 'PUT', async (ctx) => {
    const body = await readJson(ctx.req)
    const p = d.providers.find((x) => x.id === ctx.params.providerId)
    if (p) {
      Object.assign(p, body)
      p.apiKeyHint = body.apiKey ? 'sk-...mock' : p.apiKeyHint
    }
    sendJson(ctx.res, 200, p ?? { errorCode: 'NOT_FOUND', message: 'Provider not found' })
  })
  r('/users/me/providers/:providerId', 'DELETE', (ctx) => sendNoContent(ctx.res))
  r('/users/me/providers/:providerId/test', 'POST', json({ ok: true, model: 'gpt-4o-mini', message: 'Connection successful' }))
  r('/users/me/providers/:providerId/voices', 'GET', (ctx) =>
    sendJson(ctx.res, 200, d.voices.filter((v) => v.providerId === ctx.params.providerId)),
  )
  r('/users/me/providers/:providerId/voices/refresh', 'POST', (ctx) =>
    sendJson(ctx.res, 200, d.voices.filter((v) => v.providerId === ctx.params.providerId)),
  )

  r('/workspaces/:workspaceId/providers/presets', 'GET', (ctx) =>
    sendJson(ctx.res, 200, ctx.query.get('category') ? d.providerPresets.filter((p) => p.category === ctx.query.get('category')) : d.providerPresets),
  )
  r('/workspaces/:workspaceId/providers', 'GET', json(d.providers))
  r('/workspaces/:workspaceId/providers', 'POST', async (ctx) => {
    const body = await readJson(ctx.req)
    const p = {
      id: d.uuid('prov'),
      displayName: body.displayName || 'Provider',
      protocol: body.protocol || 'openai_compatible',
      capabilities: body.capabilities ?? [],
      defaultFor: body.defaultForCapabilities ?? [],
      baseUrl: body.baseUrl || '',
      apiKeyHint: body.apiKey ? 'sk-...mock' : null,
      defaultModel: body.defaultModel || '',
      enabled: body.enabled ?? true,
      temperature: body.temperature ?? null,
    }
    d.providers.push(p)
    sendJson(ctx.res, 201, p)
  })
  r('/workspaces/:workspaceId/providers/:providerId', 'PUT', async (ctx) => {
    const body = await readJson(ctx.req)
    const p = d.providers.find((x) => x.id === ctx.params.providerId)
    if (p) {
      Object.assign(p, body)
      p.apiKeyHint = body.apiKey ? 'sk-...mock' : p.apiKeyHint
      if (body.defaultForCapabilities) p.defaultFor = body.defaultForCapabilities
    }
    sendJson(ctx.res, 200, p ?? { errorCode: 'NOT_FOUND', message: 'Provider not found' })
  })
  r('/workspaces/:workspaceId/providers/:providerId', 'DELETE', (ctx) => sendNoContent(ctx.res))
  r('/workspaces/:workspaceId/providers/:providerId/default', 'POST', async (ctx) => {
    const body = await readJson(ctx.req)
    const cap = body.capability || 'TTS'
    d.providers.forEach((p) => { p.defaultFor = p.defaultFor.filter((c) => c !== cap) })
    const p = d.providers.find((x) => x.id === ctx.params.providerId)
    if (p && !p.defaultFor.includes(cap)) p.defaultFor.push(cap)
    sendJson(ctx.res, 200, p)
  })
  r('/workspaces/:workspaceId/providers/:providerId/default', 'DELETE', async (ctx) => {
    const body = await readJson(ctx.req)
    const cap = body.capability || 'TTS'
    const p = d.providers.find((x) => x.id === ctx.params.providerId)
    if (p) p.defaultFor = p.defaultFor.filter((c) => c !== cap)
    sendJson(ctx.res, 200, p)
  })
  r('/workspaces/:workspaceId/providers/:providerId/test', 'POST', json({ ok: true, model: 'gpt-4o-mini', message: 'Connection successful' }))
  r('/workspaces/:workspaceId/providers/:providerId/voices', 'GET', (ctx) =>
    sendJson(ctx.res, 200, d.voices.filter((v) => v.providerId === ctx.params.providerId)),
  )
  r('/workspaces/:workspaceId/providers/:providerId/voice-languages', 'GET', json({
    languages: [{ code: 'vi', voiceCount: 2 }, { code: 'ja', voiceCount: 1 }, { code: 'en', voiceCount: 1 }],
  }))
  r('/workspaces/:workspaceId/providers/:providerId/voices', 'POST', async (ctx) => {
    const body = await readJson(ctx.req)
    const v = {
      id: d.uuid('voice'),
      voiceId: body.voiceId || 'v',
      language: body.language || 'en',
      languages: [body.language || 'en'],
      gender: body.gender || 'FEMALE',
      displayName: body.displayName || 'Voice',
      isActive: true,
      cachedAt: CURRENT_UTC,
      providerId: ctx.params.providerId,
    }
    d.voices.push(v)
    sendJson(ctx.res, 201, v)
  })
  r('/workspaces/:workspaceId/providers/:providerId/refresh-voices', 'POST', (ctx) =>
    sendJson(ctx.res, 200, d.voices.filter((v) => v.providerId === ctx.params.providerId)),
  )
  r('/workspaces/:workspaceId/providers/:providerId/voices/preview', 'POST', json({ audioUrl: '', expiresInSeconds: 60 }))
  r('/workspaces/:workspaceId/providers/:providerId/validate', 'POST', json({
    overall: 'PASS',
    capability: 'TTS',
    connection: { status: 'PASS', durationMs: 120, message: null },
    authentication: { status: 'PASS', durationMs: 90, message: null },
    capabilityPhase: { status: 'PASS', durationMs: 200, message: null },
    optionalFeatures: {
      voiceDiscovery: { available: true, detail: null },
      modelDiscovery: { available: false, detail: 'Not supported' },
      streaming: { available: true, detail: null },
      toolCalling: { available: false, detail: 'Not supported' },
      realtime: { available: false, detail: 'Not supported' },
    },
  }))

  // ---- Workflow presets ----
  rBoth('/workspaces/:workspaceId/presets', '/workspaces/:workspaceId/workflow-presets', 'GET', (ctx) => {
    const scope = ctx.query.get('scope')
    const projectId = ctx.query.get('projectId')
    let list = d.workflowPresets
    if (scope) {
      list = list.filter((p) => p.scope === scope)
    }
    if (projectId) {
      list = list.filter((p) => p.projectId === projectId)
    }
    sendJson(ctx.res, 200, list)
  })
  rBoth('/workspaces/:workspaceId/presets', '/workspaces/:workspaceId/workflow-presets', 'POST', async (ctx) => {
    const body = await readJson(ctx.req)
    const p = {
      id: d.uuid('wfp'),
      scope: body.scope || 'WORKSPACE',
      workspaceId: ctx.params.workspaceId,
      projectId: body.projectId ?? null,
      name: body.name || 'Untitled',
      description: body.description ?? null,
      config: body.config ?? null,
      schemaVersion: body.schemaVersion ?? 1,
      active: body.active ?? true,
      isDefault: body.isDefault ?? false,
      createdAt: CURRENT_UTC,
      updatedAt: CURRENT_UTC,
    }
    d.workflowPresets.push(p)
    sendJson(ctx.res, 201, p)
  })
  rBoth('/workspaces/:workspaceId/presets/:presetId', '/workspaces/:workspaceId/workflow-presets/:presetId', 'PUT', async (ctx) => {
    const body = await readJson(ctx.req)
    const p = d.workflowPresets.find((x) => x.id === ctx.params.presetId)
    if (p) Object.assign(p, body, { updatedAt: CURRENT_UTC })
    sendJson(ctx.res, 200, p ?? { errorCode: 'NOT_FOUND', message: 'Preset not found' })
  })
  rBoth('/workspaces/:workspaceId/presets/:presetId', '/workspaces/:workspaceId/workflow-presets/:presetId', 'DELETE', (ctx) => sendNoContent(ctx.res))

  // ---- Transformation / media ----
  r('/transformation/capabilities', 'GET', json({
    protocolVersion: '1.0',
    supportedExecutionModes: ['FAST', 'STUDIO'],
    defaultExecutionMode: 'FAST',
    availability: {
      FAST: { available: true, unavailableReason: null },
      STUDIO: { available: true, unavailableReason: null },
    },
    workerCapability: { state: 'AVAILABLE', workerCount: 2, compatibleFastWorkers: 2, compatibleStudioWorkers: 1 },
    readiness: { status: 'READY', readyExecutionModes: ['FAST', 'STUDIO'], reasons: [], evaluatedAt: CURRENT_UTC },
  }))

  rBoth('/workspaces/:workspaceId/media/jobs', '/workspaces/:workspaceId/transformation/jobs', 'POST', async (ctx) => {
    const body = await readJson(ctx.req)
    const keepOriginalAudio = Boolean(body.keepOriginalAudio)
    const doc = d.documents.find((x) => x.id === body.documentId)
    const fileName = body.fileName || doc?.name || 'Video_Source.mp4'

    const job = {
      id: d.uuid('mj'),
      fileName,
      documentId: body.documentId ?? null,
      rootAssetId: 'asset_1',
      projectId: body.projectId || 'p_1',
      processingMode: body.processingMode ?? 'TRANSLATE_ONLY',
      sourceLanguage: body.sourceLang ?? 'en',
      targetLang: body.targetLang || 'vi',
      status: 'PENDING',
      subtitleMode: body.subtitleMode ?? 'SOFT_SUB',
      aspectRatio: body.aspectRatio || body.outputAspectRatio || '16:9',
      keepOriginalAudio,
      skipPresetResolution: Boolean(body.skipPresetResolution),
      requestedDurationSeconds: body.requestedDurationSeconds ?? null,
      selectedProposalId: null,
      ttsProviderId: keepOriginalAudio ? null : (body.ttsProviderId ?? null),
      ttsVoiceId: keepOriginalAudio ? null : (body.ttsVoiceId ?? null),
      recipeId: body.recipeId ?? 'localization.full',
      goalType: (body.recipeId || '').startsWith('summary') ? 'HIGHLIGHT_EXTRACTIVE' : 'LOCALIZE',
      domainPhase: 'DRAFT',
      workflowMode: body.workflowMode ?? ((body.recipeId || '').startsWith('summary') ? 'MANUAL' : 'AUTO'),
      workflowCheckpoints: [
        { id: 'CUT', state: 'PENDING', canContinue: false },
        { id: 'REVIEW', state: 'PENDING', canContinue: false },
        { id: 'EXPORT', state: 'PENDING', canContinue: false },
      ],
      createdAt: CURRENT_UTC,
      stages: [
        makeStage('EXTRACT_AUDIO', 1, 'PENDING'),
        makeStage('SOURCE_SEPARATION', 2, 'SKIPPED'),
        makeStage('STT', 3, 'PENDING'),
        makeStage('SUMMARIZE', 4, 'PENDING'),
        makeStage('TRANSLATE', 5, 'PENDING'),
        makeStage('TTS', 6, keepOriginalAudio ? 'SKIPPED' : 'PENDING'),
        makeStage('AUDIO_MIX', 7, 'PENDING'),
        makeStage('RENDER', 8, 'PENDING'),
      ],
    }
    d.mediaJobs.unshift(job)
    sendJson(ctx.res, 201, job)
  })
  rBoth('/workspaces/:workspaceId/media/jobs/:jobId', '/workspaces/:workspaceId/transformation/jobs/:jobId', 'GET', (ctx) => {
    const job = d.mediaJobs.find((j) => j.id === ctx.params.jobId)
    sendJson(ctx.res, job ? 200 : 404, job ?? { errorCode: 'NOT_FOUND', message: 'Job not found' })
  })
  rBoth('/workspaces/:workspaceId/projects/:projectId/media/jobs', '/workspaces/:workspaceId/projects/:projectId/transformation/jobs', 'GET', (ctx) =>
    sendJson(ctx.res, 200, d.mediaJobs.filter((j) => (ctx.params.projectId ? j.projectId === ctx.params.projectId : true))),
  )
  rBoth(
    '/workspaces/:workspaceId/media/jobs/:jobId/stages/:stageName/rerun',
    '/workspaces/:workspaceId/transformation/jobs/:jobId/stages/:stageName/rerun',
    'POST',
    (ctx) => {
      const job = d.mediaJobs.find((j) => j.id === ctx.params.jobId)
      if (!job) return sendJson(ctx.res, 404, { errorCode: 'NOT_FOUND', message: 'Job not found' })
      job.status = 'PROCESSING'
      const targetOrder = job.stages.find((s) => s.stageName === ctx.params.stageName)?.stageOrder ?? 1
      job.stages = job.stages.map((s) => {
        if (s.stageOrder < targetOrder) return s
        if (s.stageOrder === targetOrder) {
          return { ...s, status: 'PROCESSING', progressPercent: 20 }
        }
        return { ...s, status: 'PENDING', progressPercent: 0 }
      })
      sendJson(ctx.res, 200, job)
    },
  )
  rBoth(
    '/workspaces/:workspaceId/media/jobs/:jobId/export',
    '/workspaces/:workspaceId/transformation/jobs/:jobId/export',
    'POST',
    (ctx) => sendJson(ctx.res, 200, { downloadUrl: '/api/media/sample-video', primaryVideoDownloadUrl: '/api/media/sample-video' }),
  )
  rBoth('/workspaces/:workspaceId/media/jobs/:jobId/cancel', '/workspaces/:workspaceId/transformation/jobs/:jobId/cancel', 'POST', (ctx) => {
    const job = d.mediaJobs.find((j) => j.id === ctx.params.jobId)
    if (job) {
      job.status = 'CANCELLED'
      job.stages = job.stages.map((s) => ({
        ...s,
        status: s.status === 'COMPLETED' ? 'COMPLETED' : 'CANCELLED',
        progressPercent: s.status === 'COMPLETED' ? 100 : 0,
      }))
    }
    sendJson(ctx.res, 200, job)
  })
  // ---- Video stream routes ----
  r('/media/sample-video', 'GET', (ctx) => serveVideo(ctx))
  r('/media/stream', 'GET', (ctx) => serveVideo(ctx))
  r('/media/video', 'GET', (ctx) => serveVideo(ctx))

  rBoth('/workspaces/:workspaceId/media/jobs/:jobId/export', '/workspaces/:workspaceId/transformation/jobs/:jobId/export', 'GET', (ctx) => {
    const format = (ctx.query.get('format') || 'SRT').toUpperCase()
    const isVtt = format === 'VTT'
    const list = d.mediaSegmentsByJob[ctx.params.jobId] || d.job1Segments
    const content = isVtt
      ? 'WEBVTT - ATTT qua Mật mã học\n\n' +
        list
          .map((s, idx) => {
            const start = formatVttTime(s.startMs)
            const end = formatVttTime(s.endMs)
            return `${idx + 1}\n${start} --> ${end}\n${s.targetText}`
          })
          .join('\n\n')
      : list
          .map((s, idx) => {
            const start = formatSrtTime(s.startMs)
            const end = formatSrtTime(s.endMs)
            return `${idx + 1}\n${start} --> ${end}\n${s.targetText}`
          })
          .join('\n\n')

    sendJson(ctx.res, 200, {
      format,
      fileName: 'ATTT_qua_Mật_mã_học.' + format.toLowerCase(),
      downloadUrl: null,
      content,
    })
  })
  rBoth('/workspaces/:workspaceId/media/terms-version', '/workspaces/:workspaceId/transformation/terms-version', 'GET', json({ termsVersion: '2026.1' }))
  rBoth('/workspaces/:workspaceId/media/assets/:assetId/consent', '/workspaces/:workspaceId/transformation/assets/:assetId/consent', 'POST', (ctx) =>
    sendJson(ctx.res, 200, { id: d.uuid('c'), rootAssetId: ctx.params.assetId, termsVersion: '2026.1', consentedAt: CURRENT_UTC }),
  )
  rBoth('/workspaces/:workspaceId/media/jobs/:jobId/override-source-lang', '/workspaces/:workspaceId/transformation/jobs/:jobId/override-source-lang', 'POST', (ctx) => sendNoContent(ctx.res))
  rBoth('/workspaces/:workspaceId/media/jobs/:jobId/voice', '/workspaces/:workspaceId/transformation/jobs/:jobId/voice', 'POST', async (ctx) => {
    const body = await readJson(ctx.req)
    const job = d.mediaJobs.find((j) => j.id === ctx.params.jobId)
    if (job) {
      job.ttsProviderId = body.ttsProviderId ?? null
      job.ttsVoiceId = body.ttsVoiceId ?? null
    }
    sendNoContent(ctx.res)
  })
  rBoth('/workspaces/:workspaceId/media/jobs/:jobId/render-config', '/workspaces/:workspaceId/transformation/jobs/:jobId/render-config', 'GET', (ctx) =>
    sendJson(ctx.res, 200, makeRenderConfig(ctx.params.jobId)),
  )
  rBoth('/workspaces/:workspaceId/media/jobs/:jobId/render-config', '/workspaces/:workspaceId/transformation/jobs/:jobId/render-config', 'PUT', async (ctx) => {
    const body = await readJson(ctx.req)
    sendJson(ctx.res, 200, { ...makeRenderConfig(ctx.params.jobId), ...body })
  })
  rBoth('/workspaces/:workspaceId/media/jobs/:jobId/confirm-render', '/workspaces/:workspaceId/transformation/jobs/:jobId/confirm-render', 'POST', (ctx) => sendNoContent(ctx.res))
  rBoth('/workspaces/:workspaceId/media/jobs/:jobId/checkpoints/:checkpoint/confirm', '/workspaces/:workspaceId/transformation/jobs/:jobId/checkpoints/:checkpoint/confirm', 'POST', (ctx) => sendNoContent(ctx.res))
  rBoth('/workspaces/:workspaceId/media/jobs/:jobId/workflow/continue', '/workspaces/:workspaceId/transformation/jobs/:jobId/workflow/continue', 'POST', json({ id: 'CUT', state: 'CONFIRMED', canContinue: false }))
  rBoth('/workspaces/:workspaceId/media/jobs/:jobId/workflow/resume', '/workspaces/:workspaceId/transformation/jobs/:jobId/workflow/resume', 'POST', (ctx) => sendNoContent(ctx.res))
  rBoth('/workspaces/:workspaceId/media/jobs/:jobId/proposals', '/workspaces/:workspaceId/transformation/jobs/:jobId/proposals', 'GET', json(d.proposals))
  const proposalHandler = async (ctx) => {
    const body = await readJson(ctx.req)
    const prop = {
      id: d.uuid('prop'),
      proposal_index: d.proposals.length + 1,
      generated_by: 'HUMAN',
      generation_round: 1,
      archived_at: null,
      cut_ranges: (body.cut_ranges ?? []).map((cr) => ({ start_ms: cr.start_ms, end_ms: cr.end_ms })),
      reasoning_note: body.reasoning_note ?? null,
      total_duration_ms: 180000,
      confidence: null,
      warnings: [],
      planStatus: 'DRAFT',
      planKind: 'CUT_PLAN',
    }
    d.proposals.push(prop)
    sendJson(ctx.res, 201, prop)
  }
  rBoth('/workspaces/:workspaceId/media/jobs/:jobId/proposals', '/workspaces/:workspaceId/transformation/jobs/:jobId/proposals', 'POST', proposalHandler)
  r('/workspaces/:workspaceId/media/jobs/:jobId/proposals/custom', 'POST', proposalHandler)
  rBoth('/workspaces/:workspaceId/media/jobs/:jobId/proposals/:proposalId', '/workspaces/:workspaceId/transformation/jobs/:jobId/proposals/:proposalId', 'PUT', async (ctx) => {
    const body = await readJson(ctx.req)
    const p = d.proposals.find((x) => x.id === ctx.params.proposalId)
    if (p) {
      p.cut_ranges = (body.cut_ranges ?? p.cut_ranges).map((cr) => ({ start_ms: cr.start_ms, end_ms: cr.end_ms }))
      p.reasoning_note = body.reasoning_note ?? p.reasoning_note
    }
    sendJson(ctx.res, 200, p ?? { errorCode: 'NOT_FOUND', message: 'Proposal not found' })
  })
  rBoth('/workspaces/:workspaceId/media/jobs/:jobId/proposals/:proposalId/select', '/workspaces/:workspaceId/transformation/jobs/:jobId/proposals/:proposalId/select', 'POST', (ctx) => {
    const p = d.proposals.find((x) => x.id === ctx.params.proposalId)
    if (p) p.planStatus = 'SELECTED'
    sendJson(ctx.res, 200, p)
  })
  rBoth('/workspaces/:workspaceId/media/jobs/:jobId/refine', '/workspaces/:workspaceId/transformation/jobs/:jobId/refine', 'POST', (ctx) => sendNoContent(ctx.res))
  rBoth('/workspaces/:workspaceId/media/jobs/:jobId/summarize', '/workspaces/:workspaceId/transformation/jobs/:jobId/summarize', 'POST', (ctx) => sendNoContent(ctx.res))
  rBoth('/workspaces/:workspaceId/media/jobs/:jobId/rerun-tts-render', '/workspaces/:workspaceId/transformation/jobs/:jobId/rerun-tts-render', 'POST', (ctx) => sendNoContent(ctx.res))
  rBoth('/workspaces/:workspaceId/media/jobs/:jobId/output-package', '/workspaces/:workspaceId/transformation/jobs/:jobId/output-package', 'GET', (ctx) =>
    sendJson(ctx.res, 200, {
      jobId: ctx.params.jobId,
      primaryVideoRef: 'videos/ATTT_qua_Mật_mã_học.mp4',
      primaryVideoDownloadUrl: '/api/media/sample-video',
      audioTracks: [{ role: 'main', storageRef: 'audio/main.m4a' }],
      subtitleTracks: [
        { format: 'SRT', language: 'en', available: true },
        { format: 'VTT', language: 'en', available: true },
        { format: 'SRT', language: 'vi', available: true },
      ],
      durationMs: 374608,
      checksumSha256: '9f83a4c2e681b37498c19ef0b852934a6e3518fae4b09c2a71d830b5e82f129a',
      artifactPins: [],
    }),
  )
  rBoth('/workspaces/:workspaceId/media/jobs/:jobId/publish-package', '/workspaces/:workspaceId/transformation/jobs/:jobId/publish-package', 'GET', (ctx) =>
    sendJson(ctx.res, 200, {
      profile: 'GENERIC',
      title: 'An toàn thông tin qua Mật mã học (English Dubbed & Subtitled)',
      description: 'Bài giảng chuyên sâu về các nguyên lý mật mã học: mã hóa đối xứng, bất đối xứng, hàm băm SHA-256, chữ ký số và hạ tầng PKI.',
      language: 'en',
      tags: ['cryptography', 'security', 'cybersecurity', 'rsa', 'sha256', 'pki'],
      thumbnailRef: null,
      sourceJobId: ctx.params.jobId,
      status: 'READY',
    }),
  )
  rBoth('/workspaces/:workspaceId/media/jobs/:jobId/publish-package', '/workspaces/:workspaceId/transformation/jobs/:jobId/publish-package', 'PUT', async (ctx) => {
    const body = await readJson(ctx.req)
    sendJson(ctx.res, 200, {
      profile: 'GENERIC',
      title: body.title ?? 'An toàn thông tin qua Mật mã học',
      description: body.description ?? null,
      language: body.language ?? 'en',
      tags: body.tags ?? [],
      thumbnailRef: body.thumbnailRef ?? null,
      sourceJobId: ctx.params.jobId,
      status: 'READY',
    })
  })
  // ---- Batch edit subtitle segments (Review workbench) ----
  rBoth('/workspaces/:workspaceId/media/jobs/:jobId/segments/batch', '/workspaces/:workspaceId/transformation/jobs/:jobId/segments/batch', 'PUT', async (ctx) => {
    const body = await readJson(ctx.req)
    const list = d.mediaSegmentsByJob[ctx.params.jobId] ?? d.job1Segments
    const updates = Array.isArray(body?.updates) ? body.updates : []
    updates.forEach((u) => {
      const seg = list.find((s) => s.id === u.segmentId)
      if (seg) {
        if (u.targetText !== undefined) seg.targetText = u.targetText
        if (u.startMs !== undefined) seg.startMs = u.startMs
        if (u.endMs !== undefined) seg.endMs = u.endMs
      }
    })
    sendJson(ctx.res, 200, { segments: list })
  })
  rBoth('/workspaces/:workspaceId/projects/:projectId/media/assets', '/workspaces/:workspaceId/projects/:projectId/transformation/upload', 'POST', async (ctx) => {
    await readBody(ctx.req, 60 * 1024 * 1024)
    sendJson(ctx.res, 200, {
      documentId: d.uuid('d'),
      assetId: d.uuid('asset'),
      fileName: 'ATTT_qua_Mật_mã_học.mp4',
      fileSizeBytes: 34395081,
      durationMs: 374608,
      consented: true,
    })
  })

  // ---- Legacy media ----
  r('/workspaces/:workspaceId/media/segments/:segmentId', 'PUT', async (ctx) => {
    const body = await readJson(ctx.req)
    const seg = d.mediaSegmentsByJob.mj_1.find((s) => s.id === ctx.params.segmentId) ?? { id: ctx.params.segmentId, seq: 1, sourceText: 'Source', targetText: '', startMs: 0, endMs: 1000, status: 'TRANSLATED' }
    if (body.targetText !== undefined) seg.targetText = body.targetText
    sendJson(ctx.res, 200, seg)
  })

  // ---- Subtitle styles (global, no workspace prefix) ----
  r('/media/subtitle-styles', 'GET', json(d.subtitleStylePresets))
  r('/media/subtitle-styles/:key', 'GET', (ctx) => {
    const p = d.subtitleStylePresets.find((x) => x.key === ctx.params.key)
    sendJson(ctx.res, p ? 200 : 404, p ?? { errorCode: 'STYLE_NOT_FOUND', message: 'Style not found' })
  })
  const styleSnapshot = () => {
    const p = d.subtitleStylePresets[0]
    return {
      font_family: p.font_family, font_size: p.font_size, primary_color: p.primary_color, outline_color: p.outline_color, outline_width: p.outline_width, shadow: p.shadow, bold: p.bold, italic: p.italic, alignment: p.alignment, margin_v: p.margin_v, line_spacing: p.line_spacing, background: p.background, opacity: p.opacity,
    }
  }
  r('/media/jobs/:jobId/subtitle-style', 'GET', (ctx) => sendJson(ctx.res, 200, styleSnapshot()))
  r('/media/jobs/:jobId/subtitle-style', 'POST', (ctx) => sendJson(ctx.res, 200, styleSnapshot()))

  // ---- Notifications ----
  r('/workspaces/:workspaceId/notifications', 'GET', json(d.notifications))

  // ---- Creative Studio (production jobs) ----
  r('/workspaces/:workspaceId/production/jobs', 'GET', (ctx) => {
    const projectId = ctx.query.get('projectId')
    const list = projectId
      ? d.creativeJobs.filter((j) => j.projectId === projectId)
      : d.creativeJobs
    sendJson(ctx.res, 200, list)
  })
  r('/workspaces/:workspaceId/production/jobs/:jobId', 'GET', (ctx) => {
    const job = d.creativeJobs.find((j) => j.id === ctx.params.jobId)
    if (!job) return sendJson(ctx.res, 404, { errorCode: 'NOT_FOUND', message: 'Creative job not found' })
    sendJson(ctx.res, 200, job)
  })
  r('/workspaces/:workspaceId/production/jobs', 'POST', async (ctx) => {
    const body = await readJson(ctx.req)
    const pipelineId = body.pipelineId || 'animated_explainer'
    const defaultStages = pipelineId === 'clip_factory'
      ? [
          { id: d.uuid('stg'), stageKey: 'INGEST', stageOrder: 1, unitIndex: 0, status: 'READY_TO_PROCESS', progressPercent: 0, attemptCount: 0 },
          { id: d.uuid('stg'), stageKey: 'VISION_ANALYZE', stageOrder: 2, unitIndex: 0, status: 'PENDING', progressPercent: 0, attemptCount: 0 },
          { id: d.uuid('stg'), stageKey: 'HIGHLIGHT_SELECT', stageOrder: 3, unitIndex: 0, status: 'PENDING', progressPercent: 0, attemptCount: 0 },
          { id: d.uuid('stg'), stageKey: 'RENDER', stageOrder: 4, unitIndex: 0, status: 'PENDING', progressPercent: 0, attemptCount: 0 },
        ]
      : [
          { id: d.uuid('stg'), stageKey: 'RESEARCH', stageOrder: 1, unitIndex: 0, status: 'READY_TO_PROCESS', progressPercent: 0, attemptCount: 0 },
          { id: d.uuid('stg'), stageKey: 'SCRIPT_GEN', stageOrder: 2, unitIndex: 0, status: 'PENDING', progressPercent: 0, attemptCount: 0 },
          { id: d.uuid('stg'), stageKey: 'VISUAL_GEN', stageOrder: 3, unitIndex: 0, status: 'PENDING', progressPercent: 0, attemptCount: 0 },
          { id: d.uuid('stg'), stageKey: 'COMPOSE', stageOrder: 4, unitIndex: 0, status: 'PENDING', progressPercent: 0, attemptCount: 0 },
        ]
    const newJob = {
      id: d.uuid('prod'),
      workspaceId: ctx.params.workspaceId,
      projectId: body.projectId || 'p_1',
      pipelineId,
      manifestVersion: '1.0.0',
      manifestContentHash: 'manifest_hash',
      workflowMode: body.workflowMode || 'GUIDED_TEAM',
      status: 'PROCESSING',
      hardBudgetCapUsd: body.hardBudgetCapUsd || 50,
      spentAmountUsd: 0,
      title: body.title || 'Untitled Creative Job',
      briefSummary: body.briefSummary || '',
      createdByUserId: 'u_admin',
      createdAt: d.now(),
      updatedAt: d.now(),
      outputQuality: 'REAL',
      stages: defaultStages,
    }
    d.creativeJobs.unshift(newJob)
    sendJson(ctx.res, 201, newJob)
  })
  r('/workspaces/:workspaceId/production/jobs/:jobId/cancel', 'POST', (ctx) => {
    const job = d.creativeJobs.find((j) => j.id === ctx.params.jobId)
    if (job) {
      job.status = 'CANCELLED'
      job.cancelledAt = d.now()
    }
    sendJson(ctx.res, 200, job ?? { errorCode: 'NOT_FOUND', message: 'Creative job not found' })
  })
  r('/workspaces/:workspaceId/production/jobs/:jobId/stages/:stageId/retry', 'POST', (ctx) => {
    const job = d.creativeJobs.find((j) => j.id === ctx.params.jobId)
    const stg = job?.stages?.find((s) => s.id === ctx.params.stageId)
    if (stg) {
      stg.status = 'PROCESSING'
      stg.progressPercent = 10
      stg.attemptCount = (stg.attemptCount || 0) + 1
    }
    sendJson(ctx.res, 200, { success: true, stage: stg })
  })
  r('/workspaces/:workspaceId/production/jobs/:jobId/artifacts', 'GET', (ctx) => {
    const list = d.creativeArtifacts.filter((a) => a.productionJobId === ctx.params.jobId)
    sendJson(ctx.res, 200, list)
  })
  const handleStorageUrl = (ctx) => {
    const key = ctx.query.get('key') || 'sample'
    sendJson(ctx.res, 200, {
      url: key.endsWith('.mp4')
        ? '/api/media/sample-video'
        : 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80',
      expiresInSeconds: 3600,
    })
  }
  r('/workspaces/:workspaceId/production/jobs/:jobId/storage-url', 'GET', handleStorageUrl)
  r('/workspaces/:workspaceId/production/jobs/:jobId/storage-url', 'POST', handleStorageUrl)

  r('/workspaces/:workspaceId/production/jobs/:jobId/clip-factory/ingest', 'POST', async (ctx) => {
    await readBody(ctx.req, 100 * 1024 * 1024)
    sendJson(ctx.res, 200, {
      jobId: ctx.params.jobId,
      sourceAssetId: d.uuid('asset'),
      durationMs: 60000,
      fileSizeBytes: 24500000,
    })
  })
  r('/workspaces/:workspaceId/production/jobs/:jobId/clip-factory/run', 'POST', async (ctx) => {
    sendJson(ctx.res, 200, { jobId: ctx.params.jobId, clips: d.creativeClips })
  })
  r('/workspaces/:workspaceId/production/jobs/:jobId/clip-factory/clips', 'GET', (ctx) => {
    const list = d.creativeClips.filter((c) => c.productionJobId === ctx.params.jobId)
    sendJson(ctx.res, 200, list.length > 0 ? list : d.creativeClips)
  })
  r('/workspaces/:workspaceId/production/jobs/:jobId/animated-explainer/run', 'POST', async (ctx) => {
    const job = d.creativeJobs.find((j) => j.id === ctx.params.jobId)
    sendJson(ctx.res, 200, { jobId: ctx.params.jobId, status: 'PROCESSING', stages: job?.stages ?? [] })
  })
  r('/workspaces/:workspaceId/production/jobs/:jobId/animated-explainer/research', 'POST', async (ctx) => {
    sendJson(ctx.res, 200, { jobId: ctx.params.jobId, researchSummary: 'Mock automated research completed.' })
  })
  r('/workspaces/:workspaceId/production/jobs/:jobId/compose', 'POST', async (ctx) => {
    sendJson(ctx.res, 200, {
      jobId: ctx.params.jobId,
      compositionArtifactId: 'art_1',
      compositionRef: 'creative/composed_video.mp4',
      status: 'COMPLETED',
    })
  })

  // ---- Platform (global) ----
  r('/platform/overview', 'GET', json(d.platformOverview))
  r('/platform/status', 'GET', json(d.platformStatus))
  r('/platform/users', 'GET', (ctx) => {
    const q = (ctx.query.get('q') || '').toLowerCase().trim()
    const isAdmin = ctx.query.get('isPlatformAdmin')
    let list = d.platformUsers
    if (q) {
      list = list.filter((u) => u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    }
    if (isAdmin === 'true') {
      list = list.filter((u) => u.isPlatformAdmin)
    } else if (isAdmin === 'false') {
      list = list.filter((u) => !u.isPlatformAdmin)
    }
    pageJson(ctx, list)
  })
  r('/platform/workspaces', 'GET', (ctx) => {
    const q = (ctx.query.get('q') || '').toLowerCase().trim()
    let list = d.platformWorkspaces
    if (q) {
      list = list.filter((w) => w.name.toLowerCase().includes(q) || w.slug.toLowerCase().includes(q))
    }
    pageJson(ctx, list)
  })
  r('/platform/audit-logs', 'GET', (ctx) => {
    const action = ctx.query.get('action')
    let list = d.platformAuditLogs
    if (action) {
      list = list.filter((a) => a.action === action)
    }
    pageJson(ctx, list)
  })

  // ---- Dashboard usage ----
  r('/workspaces/:workspaceId/dashboard/usage', 'GET', json({
    totalInputTokens: 1543210,
    totalOutputTokens: 778901,
    totalTokens: 2322111,
    operationCount: 45,
    byOperation: [
      { operation: 'STT', inputTokens: 90000, outputTokens: 0, totalTokens: 90000, operationCount: 5 },
      { operation: 'TRANSLATE', inputTokens: 1200000, outputTokens: 700000, totalTokens: 1900000, operationCount: 30 },
      { operation: 'TTS', inputTokens: 0, outputTokens: 0, totalTokens: 0, operationCount: 10 },
    ],
    byModel: [
      { provider: 'mock', model: 'gpt-4o-mini', inputTokens: 1543210, outputTokens: 778901, totalTokens: 2322111, operationCount: 45 },
    ],
    cost: 'Coming soon',
  }))

  return R
}

function buildTerm(id) {
  return { id, sourceTerm: 'term', targetTerm: 'thuật ngữ', caseSensitive: false, partOfSpeech: null, note: null, updatedAt: CURRENT_UTC }
}

// ---------------------------------------------------------------------------
// SSE job stream
// ---------------------------------------------------------------------------
function handleSse(req, res) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  let seq = 1
  const write = (event, data) => {
    res.write(`id: ${seq}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    seq += 1
  }

  const run = () => {
    const newJobId = d.uuid('jtxt')
    write('job', { jobId: newJobId, status: 'PROCESSING', seq: null, stage: null, delta: null, detail: null })
    write('stage', { jobId: newJobId, status: null, seq: null, stage: 'TM_LOOKUP', delta: null, detail: null })
    write('stage', { jobId: newJobId, status: null, seq: null, stage: 'TRANSLATING', delta: null, detail: null })

    CUE_SCRIPTS.forEach((cue, idx) => {
      const i = idx + 1
      write('segment', { jobId: newJobId, status: null, seq: i, stage: 'STARTED', delta: null, detail: null })
      const words = cue.target.split(' ')
      words.forEach((w) => {
        write('token', { jobId: newJobId, status: null, seq: i, stage: null, delta: w + ' ', detail: null })
      })
      write('segment', { jobId: newJobId, status: null, seq: i, stage: 'COMPLETED', delta: null, detail: null })
    })

    write('stage', { jobId: newJobId, status: null, seq: null, stage: 'QA_CHECKING', delta: null, detail: null })
    write('stage', { jobId: newJobId, status: null, seq: null, stage: 'TM_WRITE_BACK', delta: null, detail: null })
    const detail = makeJobDetail([1, 2, 3, 4].map(buildSegment))
    write('done', { jobId: newJobId, status: 'COMPLETED', seq: null, stage: null, delta: null, detail })
    res.end()
  }

  run()
  const t = setTimeout(() => { if (!res.writableEnded) res.end() }, 20000)
  req.on('close', () => { clearTimeout(t); if (!res.writableEnded) res.end() })
}

// ---------------------------------------------------------------------------
// middleware entry
// ---------------------------------------------------------------------------
function createMockMiddleware() {
  const routes = buildRoutes()
  return function mockMiddleware(req, res, next) {
    const { path, query } = parseUrl(req)

    // SSE job stream
    if (/\/jobs\/stream$/.test(path) || /\/jobs\/[^/]+\/stream$/.test(path)) {
      return handleSse(req, res)
    }

    const hit = match(routes, path, req.method)
    if (!hit) {
      return sendJson(res, 404, { errorCode: 'NOT_FOUND', message: `Mock: no route for ${req.method} ${path}` })
    }

    const ctx = { req, res, query, params: hit.params }
    const run = () => hit.handler(ctx)
    return Promise.resolve()
      .then(run)
      .catch((err) => {
        if (res.writableEnded) return
        sendJson(res, 400, { errorCode: 'BAD_REQUEST', message: err.message })
      })
  }
}

module.exports = { createMockMiddleware }
