import fs from 'fs';
import path from 'path';
import os from 'os';
import './envConfig.js';
import { getValidToken } from './oauthService.js';

// =============================================================================
// AUDIO TOOL — Supports multiple backends:
//   1. STT: Gemini (via bundled GOOGLE_API_KEY or Google OAuth) → Whisper fallback
//   2. TTS: Edge TTS (Microsoft neural voices, zero API keys) → Web Speech fallback
// =============================================================================

// Default voice: American female (Ava), modern, energetic and clear
const DEFAULT_EDGE_VOICE = "en-US-AvaNeural";

// --- TTS TEXT SANITIZER ---
// Strip markdown / non-speakable characters so the TTS engine reads only words.
export function stripForTTS(input) {
    if (!input || typeof input !== 'string') return '';
    let text = input;

    // Code fences and inline code: keep the inner text but drop the backticks.
    text = text.replace(/```[\w-]*\n?([\s\S]*?)```/g, '$1');
    text = text.replace(/`([^`]+)`/g, '$1');

    // Markdown links: [label](url) -> label
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
    // Bare image syntax ![alt](url) -> alt
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1');

    // Headings, blockquotes, list markers at the start of a line
    text = text.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '');
    text = text.replace(/^[ \t]{0,3}>[ \t]?/gm, '');
    text = text.replace(/^[ \t]*[-*+][ \t]+/gm, '');
    text = text.replace(/^[ \t]*\d+\.[ \t]+/gm, '');

    // Bold / italic / strikethrough: drop the markers, keep the words
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
    text = text.replace(/__([^_]+)__/g, '$1');
    text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2');
    text = text.replace(/(^|[^_])_([^_\n]+)_/g, '$1$2');
    text = text.replace(/~~([^~]+)~~/g, '$1');

    // Strip raw URLs (http/https) — they sound terrible read aloud.
    text = text.replace(/https?:\/\/\S+/gi, '');

    // Emojis and other pictographs.
    try {
        text = text.replace(/\p{Extended_Pictographic}/gu, '');
    } catch {
        // Older runtimes without unicode property escapes — skip silently.
    }

    // Collapse whitespace.
    text = text.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
    return text;
}

// --- SPEECH TO TEXT ---
export async function transcribeAudio(args) {

    // Strategy 1: Gemini audio transcription (uses bundled GOOGLE_API_KEY — always available)
    const hasGeminiAccess = process.env.GOOGLE_API_KEY || process.env.GOOGLE_REFRESH_TOKEN;
    console.log(`[Audio Debug] KEY lengths: API_KEY=${process.env.GOOGLE_API_KEY?.length || 0}, REFRESH_TOKEN=${process.env.GOOGLE_REFRESH_TOKEN?.length || 0}`);

    const { filePath, base64Audio: providedBase64, mimeType: providedMimeType } = args;
    let base64Audio = providedBase64;
    let mimeType = providedMimeType || 'audio/webm';

    if (filePath && !base64Audio) {
        console.log(`🎙️ Transcribing: ${filePath}`);
        if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
        const audioBuffer = fs.readFileSync(filePath);
        base64Audio = audioBuffer.toString('base64');
        const ext = path.extname(filePath).toLowerCase();
        const mimeMap = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webm': 'audio/webm', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg' };
        mimeType = mimeMap[ext] || 'audio/webm';
    } else if (!base64Audio) {
        throw new Error("No audio data provided for transcription.");
    }

    if (hasGeminiAccess) {
        try {
            const { GoogleGenAI } = await import('@google/genai');
            // API key is the only reliable auth for Gemini generateContent (OAuth scopes don't cover it)
            const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

            const response = await genai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: [
                    { inlineData: { data: base64Audio, mimeType } },
                    [
                      'You are a speech-to-text transcriber for a voice assistant.',
                      'Transcribe the audio verbatim into a single line of plain text.',
                      'Rules:',
                      '- Use natural punctuation and sentence casing.',
                      '- For unclear words, choose the closest plausible word phonetically — do NOT write [unintelligible], [inaudible], or any bracketed placeholder.',
                      '- Preserve filler words ("uh", "um") only if clearly enunciated; otherwise omit them.',
                      '- If the audio contains no discernible speech, return an empty string. Do NOT describe what you hear (no "[silence]", no "(background noise)", no narration).',
                      '- Output ONLY the transcribed text. No quotes, no commentary, no labels.'
                    ].join('\n')
                ]
            });
            return response.candidates[0].content.parts[0].text;
        } catch (error) {
            console.error(`[Audio] Gemini transcription failed:`, error.message);
            return `Error: Gemini transcription failed - ${error.message}`;
        }
    }

    return `Error: No transcription backend available. ` +
           `Note: GitHub Models (GPT-4o) does not yet support audio transcription. ` +
           `Please connect your Google account in Settings to enable Gemini-based transcription.`;
}

// --- TEXT TO SPEECH (Gemini TTS → Edge TTS fallback → Web Speech API) ---
export async function generateSpeech(args) {
    const { voiceId } = args;
    const rawText = args.text;
    const text = stripForTTS(rawText);
    if (!text) {
        return JSON.stringify({ fallback: 'web-speech-api', text: '' });
    }
    console.log(`🗣️ Generating Speech for: "${text.substring(0, 40)}..."`);

    // Strategy 1: Gemini TTS via @google/genai (uses bundled GOOGLE_API_KEY)
    if (process.env.GOOGLE_API_KEY) {
        try {
            const { GoogleGenAI } = await import('@google/genai');
            const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

            const response = await genai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [{ text: text }],
                config: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: voiceId || 'Kore' }
                        }
                    }
                }
            });

            const audioPart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
            if (audioPart && audioPart.inlineData) {
                const { mimeType, data } = audioPart.inlineData;
                console.log(`🗣️ Gemini TTS audio generated (voice: ${voiceId || 'Kore'}, format: ${mimeType})`);
                return `data:${mimeType};base64,${data}`;
            }
            throw new Error('No audio data in Gemini response');
        } catch (error) {
            console.warn(`[Audio] Gemini TTS failed: ${error.message}. Falling back to Edge TTS...`);
        }
    }

    // Strategy 2: Edge TTS via node-edge-tts (Microsoft neural voices — free, no API key)
    try {
        const { EdgeTTS } = await import('node-edge-tts');
        const voice = voiceId || DEFAULT_EDGE_VOICE;

        const tempPath = path.join(os.tmpdir(), `edith-tts-${Date.now()}.mp3`);

        const tts = new EdgeTTS({
            voice: voice,
            lang: voice.substring(0, 5) || 'en-US',
            rate: '+5%',
            outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
        });

        await tts.ttsPromise(text, tempPath);

        if (fs.existsSync(tempPath)) {
            const audioBuffer = await fs.promises.readFile(tempPath);
            const base64Audio = audioBuffer.toString('base64');

            fs.promises.unlink(tempPath).catch(e => console.warn('Failed to delete temp TTS file:', e));

            console.log(`🗣️ Edge TTS audio generated (voice: ${voice})`);
            return `data:audio/mp3;base64,${base64Audio}`;
        } else {
            throw new Error('TTS file was not created');
        }
    } catch (error) {
        console.warn(`[Audio] Edge TTS failed: ${error.message}. Falling back to Web Speech API...`);
    }

    // Strategy 3: Return text for client-side Web Speech API (zero cost, zero keys)
    return JSON.stringify({ fallback: 'web-speech-api', text: text });
}
