// Seed data + in-memory state for the TransFlow mock API.
// Comprehensive mock dataset supporting:
// - Auth & Multi-Workspace
// - Projects & Multi-Format Documents (Video & Text)
// - Document Text Translation Jobs, Segments, History & QA
// - Media Studio (Video Translation, Narrative Cut-Plans, Audio Mixing, Subtitles & Rerun)
// - Creative Studio (Clip Factory, Animated Explainer, Documentary Montage, Storyboards & Clips)
// - Batch Matrix (Multi-file, Multi-target async batch processing)
// - Glossaries & Translation Memory (TM)
// - Providers & Voice Catalogs (Text, STT, TTS, Image Gen)
// - Platform Super Admin Console (KPI Overview, Service Health, Directory, Audit Logs)

function uuid(prefix = 'a') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Math.random()
    .toString(36)
    .slice(2, 6)}`
}

const now = () => new Date().toISOString()
const pastMinutes = (mins) => new Date(Date.now() - mins * 60 * 1000).toISOString()
const pastHours = (hrs) => new Date(Date.now() - hrs * 3600 * 1000).toISOString()
const pastDays = (days) => new Date(Date.now() - days * 86400 * 1000).toISOString()

// ---------------------------------------------------------------------------
// 1. Auth & Users
// ---------------------------------------------------------------------------
const users = [
  {
    id: 'u_admin',
    email: 'admin@transflow.io',
    fullName: 'Admin User',
    isPlatformAdmin: true,
    password: 'admin123',
  },
  {
    id: 'u_pm',
    email: 'pm@transflow.io',
    fullName: 'Minh Tran',
    isPlatformAdmin: false,
    password: 'pm123456',
  },
  {
    id: 'u_translator',
    email: 'translator@transflow.io',
    fullName: 'Lan Nguyen',
    isPlatformAdmin: false,
    password: 'translator123',
  },
  {
    id: 'u_proofreader',
    email: 'proofreader@transflow.io',
    fullName: 'Hoang Proofreader',
    isPlatformAdmin: false,
    password: 'proofreader123',
  },
  {
    id: 'u_client',
    email: 'client@transflow.io',
    fullName: 'Acme Global Client',
    isPlatformAdmin: false,
    password: 'client123',
  },
  {
    id: 'u_creator',
    email: 'creator@transflow.io',
    fullName: 'Sarah Jenkins',
    isPlatformAdmin: false,
    password: 'creator123',
  },
]

const workspaces = [
  {
    id: 'ws_1',
    name: 'Media Localization Studio',
    slug: 'media-localization',
    myRole: 'ADMIN',
  },
  {
    id: 'ws_2',
    name: 'Enterprise Docs & Marketing',
    slug: 'docs-marketing',
    myRole: 'PM',
  },
  {
    id: 'ws_3',
    name: 'Creative Video Lab',
    slug: 'creative-video-lab',
    myRole: 'ADMIN',
  },
]

const membersByWs = {
  ws_1: [
    { memberId: 'm_1_1', userId: 'u_admin', email: 'admin@transflow.io', fullName: 'Admin User', role: 'ADMIN' },
    { memberId: 'm_1_2', userId: 'u_pm', email: 'pm@transflow.io', fullName: 'Minh Tran', role: 'PM' },
    { memberId: 'm_1_3', userId: 'u_translator', email: 'translator@transflow.io', fullName: 'Lan Nguyen', role: 'TRANSLATOR' },
    { memberId: 'm_1_4', userId: 'u_proofreader', email: 'proofreader@transflow.io', fullName: 'Hoang Proofreader', role: 'PROOFREADER' },
    { memberId: 'm_1_5', userId: 'u_client', email: 'client@transflow.io', fullName: 'Acme Global Client', role: 'CLIENT' },
  ],
  ws_2: [
    { memberId: 'm_2_1', userId: 'u_pm', email: 'pm@transflow.io', fullName: 'Minh Tran', role: 'PM' },
    { memberId: 'm_2_2', userId: 'u_admin', email: 'admin@transflow.io', fullName: 'Admin User', role: 'ADMIN' },
    { memberId: 'm_2_3', userId: 'u_translator', email: 'translator@transflow.io', fullName: 'Lan Nguyen', role: 'TRANSLATOR' },
    { memberId: 'm_2_4', userId: 'u_proofreader', email: 'proofreader@transflow.io', fullName: 'Hoang Proofreader', role: 'PROOFREADER' },
    { memberId: 'm_2_5', userId: 'u_client', email: 'client@transflow.io', fullName: 'Acme Global Client', role: 'CLIENT' },
  ],
  ws_3: [
    { memberId: 'm_3_1', userId: 'u_admin', email: 'admin@transflow.io', fullName: 'Admin User', role: 'ADMIN' },
    { memberId: 'm_3_2', userId: 'u_creator', email: 'creator@transflow.io', fullName: 'Sarah Jenkins', role: 'PM' },
    { memberId: 'm_3_3', userId: 'u_translator', email: 'translator@transflow.io', fullName: 'Lan Nguyen', role: 'TRANSLATOR' },
  ],
}

// ---------------------------------------------------------------------------
// 2. Projects & Documents
// ---------------------------------------------------------------------------
const projects = [
  {
    id: 'p_1',
    name: 'An toàn thông tin qua Mật mã học',
    sourceLang: 'vi',
    defaultGlossaryId: 'g_1',
    tmEnabled: true,
    domain: 'An toàn thông tin & Mật mã',
    tone: 'Học thuật & Chuyên nghiệp',
  },
  {
    id: 'p_2',
    name: 'Modern Cryptography & Zero Knowledge (EN)',
    sourceLang: 'en',
    defaultGlossaryId: 'g_1',
    tmEnabled: true,
    domain: 'Computer Science',
    tone: 'Academic Rigor',
  },
  {
    id: 'p_3',
    name: 'TransFlow 2.0 Product Launch & Shorts',
    sourceLang: 'en',
    defaultGlossaryId: 'g_2',
    tmEnabled: true,
    domain: 'Product Marketing & SaaS',
    tone: 'Dynamic & Inspiring',
  },
  {
    id: 'p_4',
    name: 'Tài liệu Kỹ thuật & API Reference',
    sourceLang: 'vi',
    defaultGlossaryId: 'g_1',
    tmEnabled: true,
    domain: 'Software Engineering',
    tone: 'Technical Precise',
  },
]

const documents = [
  // p_1 documents
  { id: 'd_1', projectId: 'p_1', name: 'ATTT_qua_Mật_mã_học.mp4', sourceLang: 'vi', status: 'COMPLETED', origin: 'UPLOAD', createdAt: pastDays(3) },
  { id: 'd_2', projectId: 'p_1', name: 'Giao_trinh_Mat_ma_hoc.docx', sourceLang: 'vi', status: 'COMPLETED', origin: 'MANUAL', createdAt: pastDays(2) },
  { id: 'd_3', projectId: 'p_1', name: 'Bai_tap_Chu_ky_so_RSA.mp4', sourceLang: 'vi', status: 'PROCESSING', origin: 'UPLOAD', createdAt: pastHours(6) },
  // p_2 documents
  { id: 'd_4', projectId: 'p_2', name: 'Introduction_To_Modern_Cryptography.mp4', sourceLang: 'en', status: 'COMPLETED', origin: 'UPLOAD', createdAt: pastDays(5) },
  { id: 'd_5', projectId: 'p_2', name: 'Elliptic_Curve_Diffie_Hellman.txt', sourceLang: 'en', status: 'COMPLETED', origin: 'MANUAL', createdAt: pastDays(1) },
  // p_3 documents
  { id: 'd_6', projectId: 'p_3', name: 'Keynote_TransFlow_Multimodal.mp4', sourceLang: 'en', status: 'COMPLETED', origin: 'UPLOAD', createdAt: pastDays(4) },
  { id: 'd_7', projectId: 'p_3', name: 'Feature_Highlights_Social_Clips.mp4', sourceLang: 'en', status: 'PROCESSING', origin: 'UPLOAD', createdAt: pastHours(2) },
  // p_4 documents
  { id: 'd_8', projectId: 'p_4', name: 'Architecture_Specification_v2.docx', sourceLang: 'vi', status: 'COMPLETED', origin: 'UPLOAD', createdAt: pastDays(7) },
]

// ---------------------------------------------------------------------------
// 3. Subtitle Styles Presets
// ---------------------------------------------------------------------------
const subtitleStylePresets = [
  {
    key: 'modern-clean',
    name: 'Modern Clean (Tối giản thanh lịch)',
    language: 'vi',
    preview_text: 'An toàn thông tin qua Mật mã học',
    revision: 3,
    font_family: 'Arial',
    font_size: 48,
    primary_color: '#FFFFFF',
    outline_color: '#000000',
    outline_width: 4,
    shadow: true,
    bold: false,
    italic: false,
    alignment: 'center',
    margin_v: 28,
    line_spacing: 0,
    background: '#000000CC',
    opacity: 100,
  },
  {
    key: 'neo-poster',
    name: 'Neo Poster (Vàng nổi bật - Social / Shorts)',
    language: 'vi',
    preview_text: 'Mật mã học & An ninh mạng',
    revision: 2,
    font_family: 'Arial Black',
    font_size: 54,
    primary_color: '#FFD700',
    outline_color: '#000000',
    outline_width: 5,
    shadow: false,
    bold: true,
    italic: false,
    alignment: 'bottom',
    margin_v: 36,
    line_spacing: 2,
    background: '#00000080',
    opacity: 95,
  },
  {
    key: 'cyber-cyan',
    name: 'Cyber Cyan (Công nghệ tương lai)',
    language: 'vi',
    preview_text: 'RSA & Đường cong Elliptic ECC',
    revision: 1,
    font_family: 'Verdana',
    font_size: 46,
    primary_color: '#E0F7FA',
    outline_color: '#006064',
    outline_width: 4,
    shadow: true,
    bold: true,
    italic: false,
    alignment: 'bottom',
    margin_v: 32,
    line_spacing: 1,
    background: '#001e26b3',
    opacity: 98,
  },
  {
    key: 'cinema-sub',
    name: 'Cinematic Subtitle (Điện ảnh Hollywood)',
    language: 'en',
    preview_text: 'Information Security through Cryptography',
    revision: 1,
    font_family: 'Georgia',
    font_size: 44,
    primary_color: '#FFF9C4',
    outline_color: '#1A1A1A',
    outline_width: 3,
    shadow: true,
    bold: false,
    italic: false,
    alignment: 'bottom',
    margin_v: 30,
    line_spacing: 1,
    background: '#000000B0',
    opacity: 100,
  },
]

// ---------------------------------------------------------------------------
// 4. Media Studio Jobs, Checkpoints & Narrative Plans
// ---------------------------------------------------------------------------
function makeStage(name, order, status, extra = {}) {
  const base = {
    id: uuid('stage'),
    stageName: name,
    stageOrder: order,
    status,
    progressPercent: status === 'COMPLETED' ? 100 : status === 'PROCESSING' ? 45 : 0,
    attemptCount: 1,
    errorMessage: null,
    startedAt: pastHours(2),
    completedAt: status === 'COMPLETED' ? pastHours(1) : null,
  }
  return { ...base, ...extra }
}

const mediaAssets = [
  {
    id: 'asset_1',
    projectId: 'p_1',
    assetType: 'SOURCE_VIDEO',
    fileName: 'ATTT_qua_Mật_mã_học.mp4',
    mimeType: 'video/mp4',
    fileSizeBytes: 34395081,
    durationMs: 374608,
    processingStatus: 'READY',
    createdAt: pastDays(3),
  },
  {
    id: 'asset_2',
    projectId: 'p_3',
    assetType: 'SOURCE_VIDEO',
    fileName: 'Keynote_TransFlow_Multimodal.mp4',
    mimeType: 'video/mp4',
    fileSizeBytes: 89124000,
    durationMs: 720000,
    processingStatus: 'READY',
    createdAt: pastDays(2),
  },
]

const mediaJobs = [
  {
    id: 'mj_1',
    documentId: 'd_1',
    rootAssetId: 'asset_1',
    projectId: 'p_1',
    processingMode: 'TRANSLATE_ONLY',
    sourceLanguage: 'vi',
    targetLang: 'en',
    status: 'COMPLETED',
    subtitleMode: 'SOFT_SUB',
    requestedDurationSeconds: null,
    selectedProposalId: null,
    translationJobId: 'jtxt_1',
    ttsProviderId: 'prov_1',
    ttsVoiceId: 'voice_4',
    ttsProviderName: 'Local Piper',
    ttsProviderProtocol: 'local_piper',
    ttsVoiceLanguage: 'en',
    ttsVoiceGender: 'FEMALE',
    ttsVoiceDisplayName: 'Alloy (Studio Clear)',
    recipeId: 'localization.full',
    goalType: 'LOCALIZE',
    domainPhase: 'COMPLETED',
    workflowMode: 'MANUAL',
    workflowCheckpoints: [
      { id: 'CUT', state: 'COMPLETED', canContinue: false },
      { id: 'REVIEW', state: 'COMPLETED', canContinue: false },
      { id: 'EXPORT', state: 'COMPLETED', canContinue: false },
    ],
    createdAt: pastDays(2),
    stages: [
      makeStage('EXTRACT_AUDIO', 1, 'COMPLETED'),
      makeStage('SOURCE_SEPARATION', 2, 'SKIPPED'),
      makeStage('STT', 3, 'COMPLETED'),
      makeStage('SUMMARIZE', 4, 'COMPLETED'),
      makeStage('TRANSLATE', 5, 'COMPLETED'),
      makeStage('TTS', 6, 'COMPLETED'),
      makeStage('AUDIO_MIX', 7, 'COMPLETED'),
      makeStage('RENDER', 8, 'COMPLETED', { outputRef: 'ATTT_qua_Mật_mã_học_en.mp4' }),
    ],
  },
  {
    id: 'mj_2',
    documentId: 'd_1',
    rootAssetId: 'asset_1',
    projectId: 'p_1',
    processingMode: 'TRANSLATE_ONLY',
    sourceLanguage: 'vi',
    targetLang: 'ja',
    status: 'PROCESSING',
    subtitleMode: 'SOFT_SUB',
    requestedDurationSeconds: null,
    selectedProposalId: null,
    translationJobId: 'jtxt_2',
    ttsProviderId: 'prov_1',
    ttsVoiceId: 'voice_6',
    ttsProviderName: 'Local Piper',
    ttsProviderProtocol: 'local_piper',
    ttsVoiceLanguage: 'ja',
    ttsVoiceGender: 'MALE',
    ttsVoiceDisplayName: 'Kenji (Osaka)',
    recipeId: 'localization.full',
    goalType: 'LOCALIZE',
    domainPhase: 'MATERIALIZING',
    workflowMode: 'MANUAL',
    workflowCheckpoints: [
      { id: 'CUT', state: 'COMPLETED', canContinue: false },
      { id: 'REVIEW', state: 'PENDING', canContinue: false },
      { id: 'EXPORT', state: 'PENDING', canContinue: false },
    ],
    createdAt: pastHours(4),
    stages: [
      makeStage('EXTRACT_AUDIO', 1, 'COMPLETED'),
      makeStage('SOURCE_SEPARATION', 2, 'SKIPPED'),
      makeStage('STT', 3, 'COMPLETED'),
      makeStage('SUMMARIZE', 4, 'COMPLETED'),
      makeStage('TRANSLATE', 5, 'PROCESSING', { progressPercent: 65 }),
      makeStage('TTS', 6, 'PENDING'),
      makeStage('AUDIO_MIX', 7, 'PENDING'),
      makeStage('RENDER', 8, 'PENDING'),
    ],
  },
  {
    id: 'mj_3',
    documentId: 'd_1',
    rootAssetId: 'asset_1',
    projectId: 'p_1',
    processingMode: 'HYBRID',
    sourceLanguage: 'vi',
    targetLang: 'vi',
    status: 'COMPLETED',
    subtitleMode: 'HARD_SUB',
    requestedDurationSeconds: 120,
    selectedProposalId: 'prop_1',
    translationJobId: 'jtxt_3',
    ttsProviderId: null,
    ttsVoiceId: null,
    recipeId: 'summary.extractive',
    goalType: 'HIGHLIGHT_EXTRACTIVE',
    domainPhase: 'COMPLETED',
    workflowMode: 'MANUAL',
    workflowCheckpoints: [
      { id: 'CUT', state: 'COMPLETED', canContinue: false },
      { id: 'REVIEW', state: 'COMPLETED', canContinue: false },
      { id: 'EXPORT', state: 'COMPLETED', canContinue: false },
    ],
    createdAt: pastDays(1),
    stages: [
      makeStage('EXTRACT_AUDIO', 1, 'COMPLETED'),
      makeStage('SOURCE_SEPARATION', 2, 'SKIPPED'),
      makeStage('STT', 3, 'COMPLETED'),
      makeStage('SUMMARIZE', 4, 'COMPLETED'),
      makeStage('TRANSLATE', 5, 'COMPLETED'),
      makeStage('TTS', 6, 'COMPLETED'),
      makeStage('AUDIO_MIX', 7, 'COMPLETED'),
      makeStage('RENDER', 8, 'COMPLETED', { outputRef: 'ATTT_Highlights_CutPlan.mp4' }),
    ],
  },
  {
    id: 'mj_4',
    documentId: 'd_1',
    rootAssetId: 'asset_1',
    projectId: 'p_1',
    processingMode: 'CUT_AND_TRANSLATE',
    sourceLanguage: 'vi',
    targetLang: 'en',
    status: 'PROCESSING',
    subtitleMode: 'SOFT_SUB',
    requestedDurationSeconds: 180,
    selectedProposalId: null,
    translationJobId: null,
    ttsProviderId: 'prov_1',
    ttsVoiceId: 'voice_3',
    ttsVoiceDisplayName: 'Brian (Natural Academic)',
    recipeId: 'summary.abstractive',
    goalType: 'HIGHLIGHT_EXTRACTIVE',
    domainPhase: 'WAITING_FOR_PROPOSAL',
    workflowMode: 'MANUAL',
    workflowCheckpoints: [
      { id: 'CUT', state: 'PENDING', canContinue: true },
      { id: 'REVIEW', state: 'PENDING', canContinue: false },
      { id: 'EXPORT', state: 'PENDING', canContinue: false },
    ],
    createdAt: pastHours(1),
    stages: [
      makeStage('EXTRACT_AUDIO', 1, 'COMPLETED'),
      makeStage('SOURCE_SEPARATION', 2, 'SKIPPED'),
      makeStage('STT', 3, 'COMPLETED'),
      makeStage('SUMMARIZE', 4, 'COMPLETED'),
      makeStage('TRANSLATE', 5, 'PENDING'),
      makeStage('TTS', 6, 'PENDING'),
      makeStage('AUDIO_MIX', 7, 'PENDING'),
      makeStage('RENDER', 8, 'PENDING'),
    ],
  },
]

const proposals = [
  {
    id: 'prop_1',
    proposal_index: 1,
    generated_by: 'AI',
    generation_round: 1,
    archived_at: null,
    cut_ranges: [
      { start_ms: 0, end_ms: 45000 },
      { start_ms: 70000, end_ms: 155000 },
      { start_ms: 210000, end_ms: 310000 },
    ],
    reasoning_note: 'Tập trung vào 3 trọng tâm: khái niệm nền tảng, cơ chế mã hóa bất đối xứng (RSA/ECC) và ứng dụng thực tiễn của chữ ký số.',
    total_duration_ms: 230000,
    confidence: 0.94,
    warnings: [],
    planStatus: 'SELECTED',
    planKind: 'CUT_PLAN',
    narrative_plan: {
      headline: 'Bảo mật dữ liệu qua Lăng kính Mật mã hiện đại',
      hook: 'Làm thế nào để truyền tải thông tin nhạy cảm qua mạng Internet công cộng mà không bị nghe lén?',
      pacing: 'FAST',
      target_audience: 'Kỹ sư công nghệ & Sinh viên ATTT',
      chapters: [
        { title: 'Khởi đầu: Tam giác CIA', start_ms: 0, end_ms: 45000, key_takeaway: 'Confidentiality, Integrity, Availability' },
        { title: 'Mật mã bất đối xứng RSA & ECC', start_ms: 70000, end_ms: 155000, key_takeaway: 'Khóa công khai và Khóa riêng' },
        { title: 'Chữ ký số & Ứng dụng', start_ms: 210000, end_ms: 310000, key_takeaway: 'Bảo đảm tính toàn vẹn và chống chối bỏ' },
      ],
      soundbites: [
        'Mật mã học là hòn đá tảng bảo vệ dữ liệu trong kỷ nguyên số.',
        'RSA và ECC đã thay đổi hoàn toàn cách thế giới bảo mật giao dịch trực tuyến.',
      ],
    },
  },
  {
    id: 'prop_2',
    proposal_index: 2,
    generated_by: 'AI',
    generation_round: 1,
    archived_at: null,
    cut_ranges: [
      { start_ms: 15000, end_ms: 70000 },
      { start_ms: 180000, end_ms: 260000 },
    ],
    reasoning_note: 'Bản tóm tắt ngắn gọn 2 phút dành cho nền tảng video ngắn (TikTok / Shorts / Reels).',
    total_duration_ms: 135000,
    confidence: 0.88,
    warnings: [],
    planStatus: 'DRAFT',
    planKind: 'CUT_PLAN',
    narrative_plan: {
      headline: 'Hiểu nhanh Mật mã học trong 2 phút',
      hook: 'Tại sao mã hóa ngân hàng của bạn không bao giờ bị bẻ gãy?',
      pacing: 'VIRAL_RAPID',
      target_audience: 'Người dùng phổ thông & Content Creator',
      chapters: [
        { title: 'Nguyên lý mã hóa', start_ms: 15000, end_ms: 70000, key_takeaway: 'Chuyển đổi bản rõ sang bản mã' },
        { title: 'Ứng dụng trong thực tế', start_ms: 180000, end_ms: 260000, key_takeaway: 'Từ ngân hàng điện tử đến tin nhắn mã hóa' },
      ],
      soundbites: [
        'Toàn bộ mạng Internet hiện đại vận hành dựa trên các phương trình toán học phức tạp này.',
      ],
    },
  },
]

function makeCue(seq, source, target, startMs, endMs, status, extra = {}) {
  return {
    id: uuid('seg'),
    seq,
    sourceText: source,
    targetText: target,
    status,
    tmScore: extra.tmScore ?? (status === 'APPROVED' ? 0.98 : null),
    qaIssues: extra.qaIssues ?? [],
    startMs,
    endMs,
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// 5. Translation Segments & Text Jobs (Editor & Media Studio)
// ---------------------------------------------------------------------------
const job1Segments = [
  makeCue(1, 'Chào mừng các bạn đến với bài giảng An toàn thông tin qua Mật mã học.', 'Welcome to the lecture on Information Security through Cryptography.', 0, 6500, 'APPROVED'),
  makeCue(2, 'Mật mã học đóng vai trò là hòn đá tảng bảo vệ dữ liệu trong kỷ nguyên số.', 'Cryptography serves as the cornerstone of data protection in the digital era.', 7000, 14200, 'APPROVED'),
  makeCue(3, 'Ba mục tiêu then chốt của an toàn thông tin gồm: tính bảo mật, toàn vẹn và khả dụng (CIA triad).', 'The three core goals of information security are Confidentiality, Integrity, and Availability (the CIA triad).', 15000, 23500, 'APPROVED'),
  makeCue(4, 'Chúng ta phân biệt hai nhánh chính: mật mã khóa đối xứng và mật mã khóa công khai.', 'We distinguish two major branches: symmetric key cryptography and public key cryptography.', 24000, 32800, 'TRANSLATED', {
    qaIssues: [{
      id: 'qa_1',
      type: 'terminology',
      severity: 'HIGH',
      message: 'Thuật ngữ "mật mã khóa công khai" nên đồng bộ thành "asymmetric key cryptography" theo glossary',
      sourceSpan: 'mật mã khóa công khai',
      targetSpan: 'public key cryptography',
      suggestion: 'Dùng "asymmetric key cryptography" per glossary',
      resolved: false,
      blockingActions: ['BLOCK_APPROVAL'],
    }],
  }),
  makeCue(5, 'Thuật toán AES và DES là những ví dụ điển hình của hệ mật mã đối xứng.', 'AES and DES algorithms are prime examples of symmetric cryptosystems.', 33500, 41000, 'APPROVED'),
  makeCue(6, 'Trong khi đó, RSA và đường cong Elliptic (ECC) thống trị trong mã hóa bất đối xứng.', 'Meanwhile, RSA and Elliptic Curve Cryptography (ECC) dominate asymmetric encryption.', 42000, 50500, 'TRANSLATED', {
    qaIssues: [{
      id: 'qa_2',
      type: 'subtitle_length',
      severity: 'MEDIUM',
      message: 'Tốc độ phụ đề hơi nhanh so với độ dài phát âm (CPS > 21)',
      sourceSpan: null,
      targetSpan: null,
      suggestion: 'Giữ nguyên hoặc kéo dài thời lượng thêm 400ms',
      resolved: false,
      blockingActions: [],
    }],
  }),
  makeCue(7, 'Hàm băm một chiều như SHA-256 đảm bảo tính toàn vẹn tuyệt đối cho dữ liệu.', 'One-way cryptographic hash functions like SHA-256 guarantee data integrity.', 51500, 59000, 'APPROVED'),
  makeCue(8, 'Chữ ký số kết hợp giữa hàm băm và khóa riêng để chống chối bỏ trách nhiệm.', 'Digital signatures combine hashing and private keys to achieve non-repudiation.', 60000, 69500, 'TRANSLATED', {
    qaIssues: [{
      id: 'qa_3',
      type: 'formatting',
      severity: 'LOW',
      message: 'Kiểm tra dấu gạch nối trong thuật ngữ "non-repudiation"',
      sourceSpan: null,
      targetSpan: 'non-repudiation',
      suggestion: 'Đã chuẩn hóa định dạng',
      resolved: true,
      blockingActions: [],
    }],
  }),
  makeCue(9, 'Hạ tầng khóa công khai PKI và chứng chỉ số X.509 là nền móng của giao thức HTTPS.', 'Public Key Infrastructure (PKI) and X.509 digital certificates form the foundation of HTTPS.', 70000, 80000, 'APPROVED'),
  makeCue(10, 'Tiếp theo, chúng ta sẽ phân tích mô hình tấn công Man-in-the-Middle và các giải pháp phòng ngừa.', 'Next, we will analyze the Man-in-the-Middle attack model and mitigation strategies.', 81000, 92000, 'TRANSLATED'),
]

const mediaSegmentsByJob = {
  mj_1: job1Segments,
  jtxt_1: job1Segments,
  mj_2: [
    makeCue(1, 'Chào mừng các bạn đến với bài giảng An toàn thông tin qua Mật mã học.', '暗号技術による情報セキュリティ講義へようこそ。', 0, 6500, 'APPROVED'),
    makeCue(2, 'Mật mã học đóng vai trò là hòn đá tảng bảo vệ dữ liệu trong kỷ nguyên số.', '暗号技術はデジタル時代におけるデータ保護の礎です。', 7000, 14200, 'APPROVED'),
    makeCue(3, 'Ba mục tiêu then chốt của an toàn thông tin gồm: tính bảo mật, toàn vẹn và khả dụng.', '情報セキュリティの3大要素は機密性、完全性、可用性です。', 15000, 23500, 'TRANSLATED'),
  ],
  mj_3: [
    makeCue(1, 'Mật mã học đóng vai trò là hòn đá tảng bảo vệ dữ liệu trong kỷ nguyên số.', 'Mật mã học đóng vai trò là hòn đá tảng bảo vệ dữ liệu trong kỷ nguyên số.', 0, 7200, 'APPROVED'),
    makeCue(2, 'Chúng ta phân biệt hai nhánh chính: mật mã khóa đối xứng và mật mã khóa công khai.', 'Chúng ta phân biệt hai nhánh chính: mật mã khóa đối xứng và mật mã khóa công khai.', 7500, 16300, 'APPROVED'),
    makeCue(3, 'Hàm băm một chiều như SHA-256 đảm bảo tính toàn vẹn tuyệt đối cho dữ liệu.', 'Hàm băm một chiều như SHA-256 đảm bảo tính toàn vẹn tuyệt đối cho dữ liệu.', 17000, 24500, 'APPROVED'),
  ],
}

// Text translation jobs for document listing & editor
const textJobs = [
  {
    id: 'jtxt_1',
    documentId: 'd_2',
    targetLang: 'en',
    status: 'COMPLETED',
    providerUsed: 'OpenAI Compatible',
    modelUsed: 'gpt-4o-mini',
    createdAt: pastDays(2),
    segments: job1Segments,
  },
  {
    id: 'jtxt_2',
    documentId: 'd_2',
    targetLang: 'ja',
    status: 'PROCESSING',
    providerUsed: 'OpenAI Compatible',
    modelUsed: 'gpt-4o-mini',
    createdAt: pastHours(5),
    segments: mediaSegmentsByJob.mj_2,
  },
  {
    id: 'jtxt_3',
    documentId: 'd_1',
    targetLang: 'vi',
    status: 'COMPLETED',
    providerUsed: 'Anthropic Claude',
    modelUsed: 'claude-3-5-sonnet',
    createdAt: pastDays(1),
    segments: mediaSegmentsByJob.mj_3,
  },
  {
    id: 'jtxt_4',
    documentId: 'd_4',
    targetLang: 'vi',
    status: 'QA_FLAGGED',
    providerUsed: 'DeepL Translate',
    modelUsed: 'deepl-pro',
    createdAt: pastHours(12),
    segments: [
      makeCue(1, 'Modern cryptography relies heavily on computational hardness assumptions.', 'Mật mã hiện đại phụ thuộc nhiều vào các giả định về độ khó tính toán.', 0, 4000, 'APPROVED'),
      makeCue(2, 'Zero-knowledge proofs enable one party to prove the truth of a statement without revealing any information.', 'Bằng chứng không tri thức cho phép một bên chứng minh tính đúng đắn của mệnh đề mà không tiết lộ bất kỳ thông tin nào.', 4200, 11000, 'TRANSLATED', {
        qaIssues: [{
          id: 'qa_zk_1',
          type: 'terminology',
          severity: 'HIGH',
          message: 'Thuật ngữ "Zero-knowledge proofs" nên dịch chuẩn hóa là "Bằng chứng không tiết lộ tri thức (ZKP)"',
          sourceSpan: 'Zero-knowledge proofs',
          targetSpan: 'Bằng chứng không tri thức',
          suggestion: 'Bằng chứng không tiết lộ tri thức',
          resolved: false,
        }],
      }),
    ],
  },
]

// ---------------------------------------------------------------------------
// 6. Providers, Voice Catalog & Capability Matrix
// ---------------------------------------------------------------------------
const providers = [
  {
    id: 'prov_1',
    displayName: 'Local Piper TTS Engine',
    protocol: 'local_piper',
    capabilities: ['TTS'],
    defaultFor: ['TTS'],
    baseUrl: 'http://localhost:8080/piper',
    apiKeyHint: null,
    defaultModel: 'piper-v1',
    enabled: true,
    temperature: null,
  },
  {
    id: 'prov_2',
    displayName: 'OpenAI Platform',
    protocol: 'openai_compatible',
    capabilities: ['TEXT', 'STT', 'EMBEDDING'],
    defaultFor: ['TEXT', 'STT', 'EMBEDDING'],
    baseUrl: 'https://api.openai.com/v1',
    apiKeyHint: 'sk-proj-...8a7F',
    defaultModel: 'gpt-4o-mini',
    enabled: true,
    temperature: 0.2,
  },
  {
    id: 'prov_3',
    displayName: 'ElevenLabs Voice AI',
    protocol: 'elevenlabs',
    capabilities: ['TTS'],
    defaultFor: [],
    baseUrl: 'https://api.elevenlabs.io/v1',
    apiKeyHint: 'xi-api-...92k1',
    defaultModel: 'eleven_multilingual_v2',
    enabled: true,
    temperature: 0.7,
  },
  {
    id: 'prov_4',
    displayName: 'ComfyUI / SDXL Image Studio',
    protocol: 'comfyui',
    capabilities: ['IMAGE'],
    defaultFor: ['IMAGE'],
    baseUrl: 'http://localhost:8188',
    apiKeyHint: null,
    defaultModel: 'sd_xl_base_1.0.safetensors',
    enabled: true,
    temperature: null,
  },
]

const voices = [
  { id: 'voice_1', voiceId: 'vi-female-1', language: 'vi', languages: ['vi'], gender: 'FEMALE', displayName: 'Hương Mai (Hà Nội - Nữ chuẩn)', isActive: true, cachedAt: now(), providerId: 'prov_1' },
  { id: 'voice_2', voiceId: 'vi-male-1', language: 'vi', languages: ['vi'], gender: 'MALE', displayName: 'Nam Khánh (TP.HCM - Nam ấm)', isActive: true, cachedAt: now(), providerId: 'prov_1' },
  { id: 'voice_3', voiceId: 'en-male-1', language: 'en', languages: ['en'], gender: 'MALE', displayName: 'Brian (Natural Academic)', isActive: true, cachedAt: now(), providerId: 'prov_1' },
  { id: 'voice_4', voiceId: 'en-female-1', language: 'en', languages: ['en', 'es'], gender: 'FEMALE', displayName: 'Alloy (Studio Clear)', isActive: true, cachedAt: now(), providerId: 'prov_1' },
  { id: 'voice_5', voiceId: 'ja-female-1', language: 'ja', languages: ['ja'], gender: 'FEMALE', displayName: 'Nanami (Tokyo)', isActive: true, cachedAt: now(), providerId: 'prov_1' },
  { id: 'voice_6', voiceId: 'ja-male-1', language: 'ja', languages: ['ja'], gender: 'MALE', displayName: 'Kenji (Osaka)', isActive: true, cachedAt: now(), providerId: 'prov_1' },
  { id: 'voice_7', voiceId: 'ko-female-1', language: 'ko', languages: ['ko'], gender: 'FEMALE', displayName: 'Minji (Seoul News)', isActive: true, cachedAt: now(), providerId: 'prov_1' },
  { id: 'voice_8', voiceId: 'zh-female-1', language: 'zh', languages: ['zh'], gender: 'FEMALE', displayName: 'Xiaoxiao (Beijing Standard)', isActive: true, cachedAt: now(), providerId: 'prov_1' },
  { id: 'voice_9', voiceId: 'el-adam', language: 'en', languages: ['en', 'vi', 'ja'], gender: 'MALE', displayName: 'Adam (Deep Narrative)', isActive: true, cachedAt: now(), providerId: 'prov_3' },
  { id: 'voice_10', voiceId: 'el-rachel', language: 'en', languages: ['en', 'es', 'fr'], gender: 'FEMALE', displayName: 'Rachel (Expressive Storyteller)', isActive: true, cachedAt: now(), providerId: 'prov_3' },
]

const providerPresets = [
  {
    id: 'preset_openai',
    displayName: 'OpenAI',
    protocol: 'openai_compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    defaultModels: { TEXT: 'gpt-4o-mini', STT: 'whisper-1', EMBEDDING: 'text-embedding-3-small' },
    capabilities: ['TEXT', 'STT', 'EMBEDDING'],
    category: 'recommended',
    authType: 'bearer_api_key',
    docsUrl: 'https://platform.openai.com/docs',
    adapter: {
      healthCheckPath: null,
      supportedEndpoints: ['/chat/completions', '/audio/transcriptions', '/embeddings'],
      voiceDiscovery: 'NONE',
      modelDiscovery: 'AUTO',
      authHeader: 'Authorization: Bearer {key}',
      requestFormat: 'openai_chat',
      responseParser: 'openai_stream',
    },
  },
  {
    id: 'preset_elevenlabs',
    displayName: 'ElevenLabs',
    protocol: 'elevenlabs',
    baseUrl: 'https://api.elevenlabs.io/v1',
    defaultModel: 'eleven_multilingual_v2',
    defaultModels: { TTS: 'eleven_multilingual_v2' },
    capabilities: ['TTS'],
    category: 'recommended',
    authType: 'bearer_api_key',
    docsUrl: 'https://elevenlabs.io/docs',
    adapter: {
      healthCheckPath: '/user',
      supportedEndpoints: ['/text-to-speech'],
      voiceDiscovery: 'API',
      modelDiscovery: 'STATIC',
      authHeader: 'xi-api-key: {key}',
      requestFormat: 'elevenlabs_json',
      responseParser: 'elevenlabs_audio',
    },
  },
]

const workflowPresets = [
  {
    id: 'wfp_1',
    scope: 'SYSTEM',
    workspaceId: null,
    projectId: null,
    name: 'Standard Multilingual Localization',
    description: 'Bản dịch tự động và tinh chỉnh phụ đề tiêu chuẩn quốc tế',
    config: {
      schemaVersion: 1,
      workflowMode: 'AUTO',
      subtitleMode: 'SOFT_SUB',
      subtitlePosition: 'BOTTOM',
      renderConfig: {},
    },
    schemaVersion: 1,
    active: true,
    isDefault: true,
    createdAt: pastDays(10),
    updatedAt: pastDays(2),
  },
  {
    id: 'wfp_2',
    scope: 'WORKSPACE',
    workspaceId: 'ws_1',
    projectId: null,
    name: 'Manual Quality Review & Dubbing Flow',
    description: 'Dành cho các khóa học và video giáo dục cần kiểm duyệt từng phân đoạn',
    config: {
      schemaVersion: 1,
      workflowMode: 'MANUAL',
      subtitleMode: 'SOFT_SUB',
      subtitlePosition: 'BOTTOM',
    },
    schemaVersion: 1,
    active: true,
    isDefault: false,
    createdAt: pastDays(8),
    updatedAt: pastDays(1),
  },
]

// ---------------------------------------------------------------------------
// 7. Glossaries & Translation Memory (TM)
// ---------------------------------------------------------------------------
const glossaries = [
  { id: 'g_1', name: 'Thuật ngữ Mật mã học & ATTT', description: 'Bảng thuật ngữ chuẩn hóa An toàn thông tin & Mật mã học', termCount: 6, updatedAt: now() },
  { id: 'g_2', name: 'Security Protocols & Standards', description: 'Giao thức HTTPS, TLS, IPSec, PKI', termCount: 3, updatedAt: now() },
]

const glossaryTerms = {
  g_1: [
    { id: 't_1', sourceTerm: 'mật mã học', targetTerm: 'cryptography', caseSensitive: false, partOfSpeech: 'noun', note: 'Khoa học về bảo mật thông tin', updatedAt: now() },
    { id: 't_2', sourceTerm: 'an toàn thông tin', targetTerm: 'information security', caseSensitive: false, partOfSpeech: 'noun', note: 'Viết tắt ATTT (InfoSec)', updatedAt: now() },
    { id: 't_3', sourceTerm: 'chữ ký số', targetTerm: 'digital signature', caseSensitive: false, partOfSpeech: 'noun', note: 'Chống chối bỏ trách nhiệm', updatedAt: now() },
    { id: 't_4', sourceTerm: 'mật mã khóa công khai', targetTerm: 'public-key cryptography', caseSensitive: false, partOfSpeech: 'noun', note: 'Hay mật mã bất đối xứng (asymmetric)', updatedAt: now() },
    { id: 't_5', sourceTerm: 'hàm băm', targetTerm: 'cryptographic hash function', caseSensitive: false, partOfSpeech: 'noun', note: 'SHA-256, MD5, SHA-3', updatedAt: now() },
    { id: 't_6', sourceTerm: 'đường cong elliptic', targetTerm: 'elliptic curve cryptography (ECC)', caseSensitive: false, partOfSpeech: 'noun', note: 'Mã hóa hiện đại hiệu năng cao', updatedAt: now() },
  ],
  g_2: [
    { id: 't_7', sourceTerm: 'hạ tầng khóa công khai', targetTerm: 'PKI (Public Key Infrastructure)', caseSensitive: false, partOfSpeech: 'noun', note: 'Quản trị chứng chỉ số', updatedAt: now() },
    { id: 't_8', sourceTerm: 'tấn công trung gian', targetTerm: 'Man-in-the-Middle (MitM) attack', caseSensitive: false, partOfSpeech: 'noun', note: 'Tấn công nghe lén/chèn sửa', updatedAt: now() },
    { id: 't_9', sourceTerm: 'chứng chỉ số', targetTerm: 'digital certificate (X.509)', caseSensitive: false, partOfSpeech: 'noun', note: 'Chứng thực danh tính số', updatedAt: now() },
  ],
}

const tmEntries = [
  { id: 'tm_1', sourceLang: 'vi', targetLang: 'en', sourceText: 'Chào mừng các bạn đến với bài giảng An toàn thông tin qua Mật mã học.', targetText: 'Welcome to the lecture on Information Security through Cryptography.', domain: 'Cybersecurity', origin: 'APPROVED', quality: 0.99, updatedAt: now() },
  { id: 'tm_2', sourceLang: 'vi', targetLang: 'en', sourceText: 'Mật mã học đóng vai trò là hòn đá tảng bảo vệ dữ liệu trong kỷ nguyên số.', targetText: 'Cryptography serves as the cornerstone of data protection in the digital era.', domain: 'Cybersecurity', origin: 'APPROVED', quality: 0.98, updatedAt: now() },
  { id: 'tm_3', sourceLang: 'vi', targetLang: 'en', sourceText: 'Hàm băm một chiều như SHA-256 đảm bảo tính toàn vẹn tuyệt đối cho dữ liệu.', targetText: 'One-way cryptographic hash functions like SHA-256 guarantee data integrity.', domain: 'Cybersecurity', origin: 'APPROVED', quality: 0.97, updatedAt: now() },
  { id: 'tm_4', sourceLang: 'vi', targetLang: 'ja', sourceText: 'Chào mừng các bạn đến với bài giảng An toàn thông tin qua Mật mã học.', targetText: '暗号技術による情報セキュリティ講義へようこそ。', domain: 'Cybersecurity', origin: 'APPROVED', quality: 0.99, updatedAt: now() },
]

// ---------------------------------------------------------------------------
// 8. Batches
// ---------------------------------------------------------------------------
const batches = [
  {
    id: 'b_1',
    projectId: 'p_1',
    name: 'Khóa học Mật mã học 2026',
    status: 'COMPLETED',
    totalDocuments: 3,
    completedDocuments: 3,
    failedDocuments: 0,
    totalSizeBytes: 34395081,
    createdAt: pastDays(3),
    updatedAt: pastDays(2),
  },
  {
    id: 'b_2',
    projectId: 'p_2',
    name: 'Zero-Knowledge Proofs Whitepaper Series',
    status: 'PROCESSING',
    totalDocuments: 2,
    completedDocuments: 1,
    failedDocuments: 0,
    totalSizeBytes: 18450000,
    createdAt: pastHours(4),
    updatedAt: pastMinutes(10),
  },
  {
    id: 'b_3',
    projectId: 'p_3',
    name: 'TransFlow Launch Campaign Shorts Pack',
    status: 'COMPLETED',
    totalDocuments: 2,
    completedDocuments: 2,
    failedDocuments: 0,
    totalSizeBytes: 89124000,
    createdAt: pastDays(1),
    updatedAt: pastHours(2),
  },
]

const batchDetails = {
  b_1: {
    id: 'b_1',
    projectId: 'p_1',
    name: 'Khóa học Mật mã học 2026',
    status: 'COMPLETED',
    totalDocuments: 3,
    completedDocuments: 3,
    failedDocuments: 0,
    totalSizeBytes: 34395081,
    createdAt: pastDays(3),
    updatedAt: pastDays(2),
    documents: [
      {
        documentId: 'd_1',
        name: 'ATTT_qua_Mật_mã_học.mp4',
        sourceLang: 'vi',
        origin: 'UPLOAD',
        status: 'COMPLETED',
        jobs: [
          { jobId: 'mj_1', targetLang: 'en', status: 'COMPLETED' },
          { jobId: 'mj_2', targetLang: 'ja', status: 'PROCESSING' },
          { jobId: 'mj_3', targetLang: 'vi', status: 'COMPLETED' },
        ],
      },
      {
        documentId: 'd_2',
        name: 'Giao_trinh_Mat_ma_hoc.docx',
        sourceLang: 'vi',
        origin: 'MANUAL',
        status: 'COMPLETED',
        jobs: [
          { jobId: 'jtxt_1', targetLang: 'en', status: 'COMPLETED' },
        ],
      },
      {
        documentId: 'd_3',
        name: 'Bai_tap_Chu_ky_so_RSA.mp4',
        sourceLang: 'vi',
        origin: 'UPLOAD',
        status: 'COMPLETED',
        jobs: [
          { jobId: 'mj_4', targetLang: 'en', status: 'COMPLETED' },
        ],
      },
    ],
  },
  b_2: {
    id: 'b_2',
    projectId: 'p_2',
    name: 'Zero-Knowledge Proofs Whitepaper Series',
    status: 'PROCESSING',
    totalDocuments: 2,
    completedDocuments: 1,
    failedDocuments: 0,
    totalSizeBytes: 18450000,
    createdAt: pastHours(4),
    updatedAt: pastMinutes(10),
    documents: [
      {
        documentId: 'd_4',
        name: 'Introduction_To_Modern_Cryptography.mp4',
        sourceLang: 'en',
        origin: 'UPLOAD',
        status: 'COMPLETED',
        jobs: [
          { jobId: 'jtxt_4', targetLang: 'vi', status: 'COMPLETED' },
        ],
      },
      {
        documentId: 'd_5',
        name: 'Elliptic_Curve_Diffie_Hellman.txt',
        sourceLang: 'en',
        origin: 'MANUAL',
        status: 'PROCESSING',
        jobs: [
          { jobId: 'jtxt_5', targetLang: 'vi', status: 'PROCESSING' },
        ],
      },
    ],
  },
  b_3: {
    id: 'b_3',
    projectId: 'p_3',
    name: 'TransFlow Launch Campaign Shorts Pack',
    status: 'COMPLETED',
    totalDocuments: 2,
    completedDocuments: 2,
    failedDocuments: 0,
    totalSizeBytes: 89124000,
    createdAt: pastDays(1),
    updatedAt: pastHours(2),
    documents: [
      {
        documentId: 'd_6',
        name: 'Keynote_TransFlow_Multimodal.mp4',
        sourceLang: 'en',
        origin: 'UPLOAD',
        status: 'COMPLETED',
        jobs: [
          { jobId: 'mj_6', targetLang: 'vi', status: 'COMPLETED' },
        ],
      },
      {
        documentId: 'd_7',
        name: 'Feature_Highlights_Social_Clips.mp4',
        sourceLang: 'en',
        origin: 'UPLOAD',
        status: 'COMPLETED',
        jobs: [
          { jobId: 'mj_7', targetLang: 'vi', status: 'COMPLETED' },
        ],
      },
    ],
  },
}

// ---------------------------------------------------------------------------
// 9. Creative Studio (Jobs, Clips & Production Artifacts)
// ---------------------------------------------------------------------------
const creativeJobs = [
  {
    id: 'prod_1',
    workspaceId: 'ws_1',
    projectId: 'p_3',
    pipelineId: 'clip_factory',
    manifestVersion: '1.0.0',
    manifestContentHash: 'hash123',
    workflowMode: 'QUICK_CREATOR',
    status: 'COMPLETED',
    hardBudgetCapUsd: 15.0,
    spentAmountUsd: 2.35,
    title: 'TransFlow 2.0 Viral Feature Highlights',
    briefSummary: 'Trích xuất tự động 3 viral clips kèm phụ đề phong cách mạng xã hội và âm nhạc',
    createdByUserId: 'u_admin',
    createdAt: pastDays(2),
    updatedAt: pastHours(8),
    outputQuality: 'REAL',
    stages: [
      { id: 'stg_1', productionJobId: 'prod_1', stageKey: 'INGEST', stageOrder: 1, unitIndex: 0, status: 'COMPLETED', progressPercent: 100, attemptCount: 1, executionTimeMs: 1200 },
      { id: 'stg_2', productionJobId: 'prod_1', stageKey: 'VISION_ANALYZE', stageOrder: 2, unitIndex: 0, status: 'COMPLETED', progressPercent: 100, attemptCount: 1, executionTimeMs: 3400 },
      { id: 'stg_3', productionJobId: 'prod_1', stageKey: 'HIGHLIGHT_SELECT', stageOrder: 3, unitIndex: 0, status: 'COMPLETED', progressPercent: 100, attemptCount: 1, executionTimeMs: 2100 },
      { id: 'stg_4', productionJobId: 'prod_1', stageKey: 'RENDER', stageOrder: 4, unitIndex: 0, status: 'COMPLETED', progressPercent: 100, attemptCount: 1, executionTimeMs: 8200 },
    ],
  },
  {
    id: 'prod_2',
    workspaceId: 'ws_1',
    projectId: 'p_1',
    pipelineId: 'animated_explainer',
    manifestVersion: '1.0.0',
    manifestContentHash: 'hash456',
    workflowMode: 'GUIDED_TEAM',
    status: 'PROCESSING',
    hardBudgetCapUsd: 25.0,
    spentAmountUsd: 4.10,
    title: 'Giải thích Kiến trúc Mật mã & Zero Knowledge',
    briefSummary: 'Video hoạt họa 2D giải thích trực quan về cơ chế bảo mật và trao đổi khóa bí mật',
    createdByUserId: 'u_admin',
    createdAt: pastHours(6),
    updatedAt: pastMinutes(15),
    outputQuality: 'REAL',
    stages: [
      { id: 'stg_5', productionJobId: 'prod_2', stageKey: 'RESEARCH', stageOrder: 1, unitIndex: 0, status: 'COMPLETED', progressPercent: 100, attemptCount: 1, executionTimeMs: 2300 },
      { id: 'stg_6', productionJobId: 'prod_2', stageKey: 'SCRIPT_GEN', stageOrder: 2, unitIndex: 0, status: 'COMPLETED', progressPercent: 100, attemptCount: 1, executionTimeMs: 1500 },
      { id: 'stg_7', productionJobId: 'prod_2', stageKey: 'VISUAL_GEN', stageOrder: 3, unitIndex: 0, status: 'PROCESSING', progressPercent: 55, attemptCount: 1, executionTimeMs: 4000 },
      { id: 'stg_8', productionJobId: 'prod_2', stageKey: 'COMPOSE', stageOrder: 4, unitIndex: 0, status: 'PENDING', progressPercent: 0, attemptCount: 0 },
    ],
  },
  {
    id: 'prod_3',
    workspaceId: 'ws_1',
    projectId: 'p_2',
    pipelineId: 'documentary_montage',
    manifestVersion: '1.0.0',
    manifestContentHash: 'hash789',
    workflowMode: 'GUIDED_TEAM',
    status: 'COMPLETED',
    hardBudgetCapUsd: 40.0,
    spentAmountUsd: 12.80,
    title: 'The History of Modern Cryptography (Documentary)',
    briefSummary: 'Phim tài liệu ngắn về cuộc cách mạng mật mã học từ Thế chiến II đến Kỷ nguyên Lượng tử',
    createdByUserId: 'u_admin',
    createdAt: pastDays(4),
    updatedAt: pastDays(1),
    outputQuality: 'REAL',
    stages: [
      { id: 'stg_9', productionJobId: 'prod_3', stageKey: 'RESEARCH', stageOrder: 1, unitIndex: 0, status: 'COMPLETED', progressPercent: 100, attemptCount: 1, executionTimeMs: 4200 },
      { id: 'stg_10', productionJobId: 'prod_3', stageKey: 'SCRIPT_GEN', stageOrder: 2, unitIndex: 0, status: 'COMPLETED', progressPercent: 100, attemptCount: 1, executionTimeMs: 2800 },
      { id: 'stg_11', productionJobId: 'prod_3', stageKey: 'VISUAL_GEN', stageOrder: 3, unitIndex: 0, status: 'COMPLETED', progressPercent: 100, attemptCount: 1, executionTimeMs: 11000 },
      { id: 'stg_12', productionJobId: 'prod_3', stageKey: 'COMPOSE', stageOrder: 4, unitIndex: 0, status: 'COMPLETED', progressPercent: 100, attemptCount: 1, executionTimeMs: 9500 },
    ],
  },
]

const creativeClips = [
  {
    id: 'clip_1',
    productionJobId: 'prod_1',
    clipIndex: 1,
    startTimeMs: 10000,
    endTimeMs: 28000,
    durationMs: 18000,
    viralScore: 0.94,
    headline: 'Bước đột phá trong Dịch thuật AI Đa phương thức',
    summary: 'Tự động tách âm nền, đồng bộ nhép môi và giữ nguyên 100% cảm xúc của diễn giả gốc.',
    contentRef: 'creative/prod_1/clip_1.mp4',
  },
  {
    id: 'clip_2',
    productionJobId: 'prod_1',
    clipIndex: 2,
    startTimeMs: 42000,
    endTimeMs: 71000,
    durationMs: 29000,
    viralScore: 0.89,
    headline: 'Live Demo Lồng tiếng Tức thì 119 Ngôn ngữ',
    summary: 'Biên dịch video trực tiếp với khả năng phát hiện lỗi QA và chỉnh sửa phụ đề thời gian thực.',
    contentRef: 'creative/prod_1/clip_2.mp4',
  },
  {
    id: 'clip_3',
    productionJobId: 'prod_1',
    clipIndex: 3,
    startTimeMs: 95000,
    endTimeMs: 125000,
    durationMs: 30000,
    viralScore: 0.85,
    headline: 'Tiết kiệm 80% Chi phí Hậu kỳ Video',
    summary: 'Workflow tự động hóa từ trích xuất audio, tổng hợp giọng nói đến render video chất lượng 4K.',
    contentRef: 'creative/prod_1/clip_3.mp4',
  },
]

const creativeArtifacts = [
  {
    id: 'art_1',
    productionJobId: 'prod_1',
    workspaceId: 'ws_1',
    artifactType: 'VIDEO',
    logicalKey: 'FINAL_RENDER',
    version: 1,
    status: 'READY',
    contentRef: 'creative/prod_1/final.mp4',
    fileSizeBytes: 12450000,
    durationMs: 18000,
    width: 1080,
    height: 1920,
    createdAt: pastHours(8),
  },
  {
    id: 'art_2',
    productionJobId: 'prod_2',
    workspaceId: 'ws_1',
    artifactType: 'SCRIPT',
    logicalKey: 'APPROVED_SCRIPT',
    version: 2,
    status: 'READY',
    contentRef: 'creative/prod_2/script.json',
    contentJson: {
      title: 'Hiểu rõ Zero-Knowledge Proofs trong 3 phút',
      scenes: [
        { index: 1, durationSeconds: 15, narration: 'Hãy tưởng tượng bạn bước vào một hang động thần bí...', visualPrompt: 'Ancient mysterious cave with two secret passages' },
        { index: 2, durationSeconds: 25, narration: 'Bạn có thể chứng minh mình biết mật mã mở cửa mà không cần tiết lộ từ khóa bí mật?', visualPrompt: 'Magical glowing door at the end of the cave passage' },
      ],
    },
    createdAt: pastHours(2),
  },
]

// ---------------------------------------------------------------------------
// 10. Platform Super Admin (Overview, Status, Users, Workspaces, Audit)
// ---------------------------------------------------------------------------
const platformOverview = {
  from: pastDays(30),
  to: now(),
  users: { total: 128, newInRange: 24 },
  workspaces: { total: 14, newInRange: 3 },
  jobs: {
    textJobs: { created: 184, completed: 172, failed: 4, processing: 8, other: 0 },
    batchJobs: { created: 42, completed: 39, failed: 1, processing: 2, other: 0 },
    mediaJobs: { available: true, created: 96, completed: 88, failed: 3, processing: 5 },
    productionJobs: { available: true, created: 28, completed: 24, failed: 1, processing: 3 },
  },
  tokens: {
    inputTokens: 14250000,
    outputTokens: 6890000,
    totalTokens: 21140000,
    byOperation: {
      STT: { inputTokens: 2800000, outputTokens: 0 },
      TRANSLATE: { inputTokens: 9800000, outputTokens: 6200000 },
      TTS: { inputTokens: 1650000, outputTokens: 690000 },
    },
  },
  failRate: { rate: 0.021, failedCount: 9, terminalCount: 428 },
  topWorkspaces: [
    { workspaceId: 'ws_1', workspaceName: 'Media Localization Studio', totalTokens: 12400000, jobCount: 168 },
    { workspaceId: 'ws_2', workspaceName: 'Enterprise Docs & Marketing', totalTokens: 5300000, jobCount: 114 },
    { workspaceId: 'ws_3', workspaceName: 'Creative Video Lab', totalTokens: 3440000, jobCount: 60 },
  ],
}

const platformStatus = {
  checkedAt: now(),
  overall: 'UP',
  services: [
    { id: 'db', name: 'PostgreSQL Core Database', status: 'UP', latencyMs: 8, message: 'Connections: 24/100 pool' },
    { id: 'redis', name: 'Redis Queue & Cache', status: 'UP', latencyMs: 2, message: 'Memory used: 142MB' },
    { id: 'worker', name: 'Media Transcode Worker Fleet', status: 'UP', latencyMs: 35, message: '8/8 workers healthy' },
    { id: 'comp_worker', name: 'Composition & Render Worker', status: 'UP', latencyMs: 28, message: 'GPU accelerated' },
    { id: 'storage', name: 'S3 / MinIO Object Storage', status: 'UP', latencyMs: 14, message: 'Storage: 84.2GB used' },
    { id: 'ai_gateway', name: 'AI Inference Gateway', status: 'UP', latencyMs: 85, message: 'All upstream models reachable' },
  ],
}

const platformUsers = [
  { id: 'u_admin', email: 'admin@transflow.io', fullName: 'Admin User', status: 'ACTIVE', isPlatformAdmin: true, createdAt: pastDays(90), workspaceCount: 3 },
  { id: 'u_pm', email: 'pm@transflow.io', fullName: 'Minh Tran', status: 'ACTIVE', isPlatformAdmin: false, createdAt: pastDays(60), workspaceCount: 2 },
  { id: 'u_translator', email: 'translator@transflow.io', fullName: 'Lan Nguyen', status: 'ACTIVE', isPlatformAdmin: false, createdAt: pastDays(45), workspaceCount: 3 },
  { id: 'u_proofreader', email: 'proofreader@transflow.io', fullName: 'Hoang Proofreader', status: 'ACTIVE', isPlatformAdmin: false, createdAt: pastDays(40), workspaceCount: 2 },
  { id: 'u_creator', email: 'creator@transflow.io', fullName: 'Sarah Jenkins', status: 'ACTIVE', isPlatformAdmin: false, createdAt: pastDays(30), workspaceCount: 1 },
  { id: 'u_client', email: 'client@transflow.io', fullName: 'Acme Global Client', status: 'ACTIVE', isPlatformAdmin: false, createdAt: pastDays(25), workspaceCount: 2 },
  { id: 'u_david', email: 'david.chen@enterprise.com', fullName: 'David Chen', status: 'ACTIVE', isPlatformAdmin: false, createdAt: pastDays(15), workspaceCount: 1 },
  { id: 'u_elena', email: 'elena.rostova@media.org', fullName: 'Elena Rostova', status: 'ACTIVE', isPlatformAdmin: false, createdAt: pastDays(10), workspaceCount: 1 },
]

const platformWorkspaces = [
  { id: 'ws_1', name: 'Media Localization Studio', slug: 'media-localization', ownerUserId: 'u_admin', ownerEmail: 'admin@transflow.io', memberCount: 5, createdAt: pastDays(90) },
  { id: 'ws_2', name: 'Enterprise Docs & Marketing', slug: 'docs-marketing', ownerUserId: 'u_pm', ownerEmail: 'pm@transflow.io', memberCount: 5, createdAt: pastDays(60) },
  { id: 'ws_3', name: 'Creative Video Lab', slug: 'creative-video-lab', ownerUserId: 'u_admin', ownerEmail: 'admin@transflow.io', memberCount: 3, createdAt: pastDays(30) },
  { id: 'ws_4', name: 'FinTech Legal Translations', slug: 'fintech-legal', ownerUserId: 'u_david', ownerEmail: 'david.chen@enterprise.com', memberCount: 4, createdAt: pastDays(15) },
  { id: 'ws_5', name: 'Global EdTech Academy', slug: 'edtech-academy', ownerUserId: 'u_elena', ownerEmail: 'elena.rostova@media.org', memberCount: 8, createdAt: pastDays(10) },
]

const platformAuditLogs = [
  { id: 'aud_1', actorUserId: 'u_admin', action: 'LOGIN', httpMethod: 'POST', path: '/api/auth/login', queryString: null, ip: '127.0.0.1', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', statusCode: 200, createdAt: pastMinutes(10) },
  { id: 'aud_2', actorUserId: 'u_admin', action: 'WORKSPACE_UPDATE', httpMethod: 'PUT', path: '/api/workspaces/ws_1', queryString: null, ip: '127.0.0.1', userAgent: 'Mozilla/5.0', statusCode: 200, createdAt: pastHours(1) },
  { id: 'aud_3', actorUserId: 'u_pm', action: 'JOB_CREATE', httpMethod: 'POST', path: '/api/workspaces/ws_1/transformation/jobs', queryString: null, ip: '192.168.1.15', userAgent: 'Mozilla/5.0', statusCode: 201, createdAt: pastHours(2) },
  { id: 'aud_4', actorUserId: 'u_admin', action: 'PROVIDER_UPDATE', httpMethod: 'PUT', path: '/api/workspaces/ws_1/providers/prov_2', queryString: null, ip: '127.0.0.1', userAgent: 'Mozilla/5.0', statusCode: 200, createdAt: pastHours(4) },
  { id: 'aud_5', actorUserId: 'u_translator', action: 'SEGMENT_APPROVE', httpMethod: 'POST', path: '/api/workspaces/ws_1/segments/seg_1/approve', queryString: null, ip: '192.168.1.28', userAgent: 'Mozilla/5.0', statusCode: 200, createdAt: pastHours(5) },
  { id: 'aud_6', actorUserId: 'u_admin', action: 'CREATIVE_JOB_COMPOSE', httpMethod: 'POST', path: '/api/workspaces/ws_1/production/jobs/prod_1/compose', queryString: null, ip: '127.0.0.1', userAgent: 'Mozilla/5.0', statusCode: 200, createdAt: pastHours(8) },
  { id: 'aud_7', actorUserId: 'u_pm', action: 'BATCH_CREATE', httpMethod: 'POST', path: '/api/workspaces/ws_1/batches', queryString: null, ip: '192.168.1.15', userAgent: 'Mozilla/5.0', statusCode: 201, createdAt: pastDays(1) },
  { id: 'aud_8', actorUserId: 'u_admin', action: 'USER_INVITE', httpMethod: 'POST', path: '/api/workspaces/ws_3/members', queryString: null, ip: '127.0.0.1', userAgent: 'Mozilla/5.0', statusCode: 201, createdAt: pastDays(2) },
]

// ---------------------------------------------------------------------------
// 11. Notifications
// ---------------------------------------------------------------------------
const notifications = [
  {
    id: 'n_1',
    type: 'JOB_COMPLETED',
    title: 'Hoàn tất bản dịch video',
    message: 'Bản dịch tiếng Anh và lồng tiếng cho ATTT_qua_Mật_mã_học.mp4 đã sẵn sàng xuất bản.',
    relatedEntityType: 'MEDIA_JOB',
    relatedEntityId: 'mj_1',
    payload: { projectId: 'p_1', documentId: 'd_1' },
    createdAt: pastHours(2),
  },
  {
    id: 'n_2',
    type: 'QA_ISSUE',
    title: 'Cảnh báo QA thuật ngữ',
    message: 'Phát hiện 1 thuật ngữ mật mã học cần đối soát tại phân đoạn 00:24.',
    relatedEntityType: 'MEDIA_JOB',
    relatedEntityId: 'mj_1',
    payload: { segmentId: 'seg_4' },
    createdAt: pastHours(3),
  },
  {
    id: 'n_3',
    type: 'BATCH_COMPLETED',
    title: 'Hoàn thành Batch Localization',
    message: 'Batch "Khóa học Mật mã học 2026" đã hoàn tất xử lý 3/3 tài liệu.',
    relatedEntityType: 'BATCH',
    relatedEntityId: 'b_1',
    payload: { batchId: 'b_1' },
    createdAt: pastDays(1),
  },
  {
    id: 'n_4',
    type: 'CREATIVE_COMPLETED',
    title: 'Creative Studio: Hoàn thành Viral Clips',
    message: 'Bộ 3 highlight clips cho dự án TransFlow Launch đã render thành công.',
    relatedEntityType: 'PRODUCTION_JOB',
    relatedEntityId: 'prod_1',
    payload: { jobId: 'prod_1' },
    createdAt: pastHours(8),
  },
]

module.exports = {
  uuid,
  now,
  users,
  workspaces,
  membersByWs,
  projects,
  documents,
  subtitleStylePresets,
  mediaAssets,
  mediaJobs,
  proposals,
  job1Segments,
  mediaSegmentsByJob,
  textJobs,
  providers,
  voices,
  providerPresets,
  workflowPresets,
  glossaries,
  glossaryTerms,
  tmEntries,
  batches,
  batchDetails,
  notifications,
  platformOverview,
  platformStatus,
  platformUsers,
  platformWorkspaces,
  platformAuditLogs,
  creativeJobs,
  creativeClips,
  creativeArtifacts,
}
