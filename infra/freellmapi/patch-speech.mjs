// Build-time patch for the FreeLLMAPI image (TransFlow fork: duckziec/freellmapi).
//
// Upstream `services/media.js` (image ghcr.io/tashfeenahmed/freellmapi, see Dockerfile):
//  1. Cloudflare TTS sent the MeloTTS body `{prompt, lang:'en'}` to every @cf model and
//     parsed a JSON `result.audio`. Deepgram Aura needs `{text, speaker}` and answers raw
//     MPEG bytes, so aura-1 / aura-2-en / aura-2-es failed 100 %.
//  2. English-only / Spanish-only Cloudflare models were tried for any text (MeloTTS on
//     Workers AI only speaks English: fr/es → 404 "Invalid input", zh → a 44-byte empty
//     WAV). The language now comes from the optional `language` request field, else from
//     the text's script, and models that cannot speak it are skipped without a call.
//     Header-only / near-empty audio is treated as a failure so the chain moves on.
//  3. TTS used ONE random key per model and never benched a 429'd key. It now walks every
//     usable key of the model (random order, cooldown-aware) before moving on, like chat/STT.
//
// Every replacement must match exactly once, so an upstream change fails the build
// instead of silently shipping an unpatched or half-patched file.
import { readFileSync, writeFileSync } from 'node:fs';

const DIST = process.argv[2] ?? '/app/server/dist';

function patch(file, replacements) {
    const path = `${DIST}/${file}`;
    let source = readFileSync(path, 'utf8');
    for (const [name, before, after] of replacements) {
        const count = source.split(before).length - 1;
        if (count !== 1) {
            throw new Error(`[patch-speech] ${file}: anchor "${name}" matched ${count} times (expected 1)`);
        }
        source = source.replace(before, () => after);
    }
    writeFileSync(path, source);
    console.log(`[patch-speech] ${file}: ${replacements.length} replacement(s) applied`);
}

const HELPERS = `// ── TransFlow patch: speech language + Deepgram Aura + key rotation ──
const AURA_1_SPEAKERS = new Set(['angus', 'asteria', 'arcas', 'orion', 'orpheus', 'athena', 'luna', 'zeus',
    'perseus', 'helios', 'hera', 'stella']);
const AURA_2_EN_SPEAKERS = new Set(['amalthea', 'andromeda', 'apollo', 'arcas', 'aries', 'asteria', 'athena',
    'atlas', 'aurora', 'callista', 'cora', 'cordelia', 'delia', 'draco', 'electra', 'harmonia', 'helena', 'hera',
    'hermes', 'hyperion', 'iris', 'janus', 'juno', 'jupiter', 'luna', 'mars', 'minerva', 'neptune', 'odysseus',
    'ophelia', 'orion', 'orpheus', 'pandora', 'phoebe', 'pluto', 'saturn', 'thalia', 'theia', 'vesta', 'zeus']);
// OpenAI voice names → a speaker of the same gender that exists in aura-1 AND aura-2-en.
const AURA_OPENAI_VOICE_MAP = {
    alloy: 'luna', nova: 'asteria', shimmer: 'athena', coral: 'hera', marin: 'stella',
    echo: 'orion', onyx: 'zeus', fable: 'arcas', ash: 'orpheus', sage: 'helios', verse: 'perseus', cedar: 'angus',
};
function auraSpeaker(modelId, requested) {
    const voice = normalizedVoice(requested);
    const native = modelId === '@cf/deepgram/aura-1' ? AURA_1_SPEAKERS
        : modelId === '@cf/deepgram/aura-2-en' ? AURA_2_EN_SPEAKERS : null;
    if (!native)
        return undefined; // aura-2-es: keep the model's own Spanish default speaker
    if (voice && native.has(voice))
        return voice;
    return (voice && AURA_OPENAI_VOICE_MAP[voice]) ?? 'luna';
}
/** Primary language of a speech request: explicit \`language\`, else guessed from the script. */
function speechLanguage(p) {
    const explicit = p.language?.trim().toLowerCase().split(/[-_]/)[0];
    if (explicit)
        return explicit;
    const text = p.input ?? '';
    if (/[\\u3040-\\u30ff]/.test(text))
        return 'ja';
    if (/[\\uac00-\\ud7af\\u1100-\\u11ff]/.test(text))
        return 'ko';
    if (/[\\u4e00-\\u9fff]/.test(text))
        return 'zh';
    if (/[đơưăĐƠƯĂạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(text))
        return 'vi';
    return 'en';
}
// Languages each Cloudflare speech model really speaks (measured 2026-09-26: MeloTTS
// rejects fr/es and returns an empty WAV for zh, although its docs list them).
const CF_SPEECH_LANGUAGES = {
    '@cf/myshell-ai/melotts': ['en'],
    '@cf/deepgram/aura-1': ['en'],
    '@cf/deepgram/aura-2-en': ['en'],
    '@cf/deepgram/aura-2-es': ['es'],
};
function speechSupportsLanguage(row, language) {
    const languages = row.platform === 'cloudflare' ? CF_SPEECH_LANGUAGES[row.model_id] : undefined;
    return !languages || languages.includes(language);
}
const MIN_SPEECH_AUDIO_BYTES = 256;
function shuffled(items) {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}
/** Every usable credential for a speech model: pinned key, or all platform keys in random order. */
function speechCredentials(row) {
    if (KEYLESS_CAPABLE.has(row.platform))
        return [{ id: null, key: null, baseUrl: null }];
    if (row.key_id != null || row.platform === 'custom') {
        const pinned = getProviderCredential(row);
        return pinned && !(pinned.id != null && isOnCooldown(row.platform, row.model_id, pinned.id)) ? [pinned] : [];
    }
    const rows = getDb()
        .prepare("SELECT id, encrypted_key, iv, auth_tag, base_url FROM api_keys WHERE platform = ? AND enabled = 1 AND status IN ('healthy', 'unknown')")
        .all(row.platform);
    const credentials = [];
    for (const keyRow of shuffled(rows)) {
        if (isOnCooldown(row.platform, row.model_id, keyRow.id))
            continue;
        try {
            credentials.push({
                id: keyRow.id,
                key: decrypt(keyRow.encrypted_key, keyRow.iv, keyRow.auth_tag),
                baseUrl: keyRow.base_url?.trim().replace(/\\/+$/, '') ?? null,
            });
        }
        catch {
            // undecryptable key row — skip it like getProviderCredential does
        }
    }
    return credentials;
}
// Media generations are slower than chat`;

const CLOUDFLARE_BEFORE = `            const r = await mediaFetch(\`https://api.cloudflare.com/client/v4/accounts/\${accountId}/ai/run/\${row.model_id}\`, 'cloudflare', 'audio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: \`Bearer \${token}\` },
                // MeloTTS has a language selector, not a voice selector. In particular,
                // OpenAI's default \`alloy\` must never be sent as \`lang\`.
                body: JSON.stringify({ prompt: p.input, lang: 'en' }),
            });
            const j = (await r.json());`;

const CLOUDFLARE_AFTER = `            // Deepgram Aura takes {text, speaker} and streams raw MPEG; MeloTTS takes
            // {prompt, lang} (a language selector, never OpenAI's \`alloy\`) and answers JSON.
            const deepgram = row.model_id.startsWith('@cf/deepgram/');
            const speaker = deepgram ? auraSpeaker(row.model_id, p.voice) : undefined;
            const body = deepgram
                ? { text: p.input, ...(speaker ? { speaker } : {}) }
                : { prompt: p.input, lang: 'en' };
            const r = await mediaFetch(\`https://api.cloudflare.com/client/v4/accounts/\${accountId}/ai/run/\${row.model_id}\`, 'cloudflare', 'audio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: \`Bearer \${token}\` },
                body: JSON.stringify(body),
            });
            const contentType = r.headers.get('content-type') ?? '';
            if (!contentType.includes('json')) {
                const audio = Buffer.from(await r.arrayBuffer());
                return { audio, contentType: contentType.startsWith('audio/') ? contentType : 'audio/mpeg' };
            }
            const j = (await r.json());`;

const RUN_SPEECH_BEFORE = `export async function runSpeech(model, params) {
    const chain = resolveMediaChain(model, 'audio');
    let lastError = null;
    for (const row of chain) {
        const credential = KEYLESS_CAPABLE.has(row.platform)
            ? { id: null, key: null, baseUrl: null }
            : getProviderCredential(row);
        if (!credential)
            continue;
        const started = Date.now();
        try {
            const out = await callSpeechProvider(row, credential, params);
            if (!out.audio.length)
                throw new MediaError('upstream returned no audio', 502);
            logMedia(row, credential.id, 'success', Date.now() - started, null);
            return { platform: row.platform, modelId: row.model_id, audio: out.audio, contentType: out.contentType };
        }
        catch (err) {
            const e = err instanceof MediaError ? err : new MediaError(String(err?.message ?? err), 502);
            logMedia(row, credential.id, 'error', Date.now() - started, e.message.slice(0, 300));
            lastError = e;
        }
    }
    throw chainError('audio', lastError);
}`;

const RUN_SPEECH_AFTER = `export async function runSpeech(model, params) {
    const chain = resolveMediaChain(model, 'audio');
    const language = speechLanguage(params);
    let lastError = null;
    for (const row of chain) {
        // A model that cannot speak the text's language is skipped without a call.
        if (!speechSupportsLanguage(row, language))
            continue;
        for (const credential of speechCredentials(row)) {
            const started = Date.now();
            try {
                const out = await callSpeechProvider(row, credential, params);
                // A bare WAV header (44 bytes) is "success" with no speech in it.
                if (out.audio.length < MIN_SPEECH_AUDIO_BYTES)
                    throw new MediaError(\`upstream returned no audio (\${out.audio.length} bytes)\`, 502);
                logMedia(row, credential.id, 'success', Date.now() - started, null);
                return { platform: row.platform, modelId: row.model_id, audio: out.audio, contentType: out.contentType };
            }
            catch (err) {
                const e = err instanceof MediaError ? err : new MediaError(String(err?.message ?? err), 502);
                logMedia(row, credential.id, 'error', Date.now() - started, e.message.slice(0, 300));
                lastError = e;
                // A rate-limited key is benched for this model, exactly like chat and STT.
                if (e.status === 429 && credential.id != null)
                    setCooldown(row.platform, row.model_id, credential.id);
                // 400/413 describe the request itself: another key of this model fails alike.
                if (e.status === 400 || e.status === 413)
                    break;
            }
        }
    }
    throw chainError('audio', lastError);
}`;

patch('services/media.js', [
    ['speech helpers', '// Media generations are slower than chat', HELPERS],
    ['cloudflare speech body', CLOUDFLARE_BEFORE, CLOUDFLARE_AFTER],
    ['runSpeech key rotation', RUN_SPEECH_BEFORE, RUN_SPEECH_AFTER],
]);

patch('routes/proxy.js', [
    ['speech body schema', `    voice: z.string().optional(),
    response_format: z.string().optional(),
});
proxyRouter.post('/audio/speech'`, `    voice: z.string().optional(),
    response_format: z.string().optional(),
    // TransFlow patch: optional BCP-47 language of \`input\` (routes language-specific voices).
    language: z.string().optional(),
});
proxyRouter.post('/audio/speech'`],
    ['speech params', `            input: parsed.data.input, voice: parsed.data.voice, format: parsed.data.response_format,
        });`, `            input: parsed.data.input, voice: parsed.data.voice, format: parsed.data.response_format,
            language: parsed.data.language,
        });`],
]);
