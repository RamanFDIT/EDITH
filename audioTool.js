import fs from 'fs';
import path from 'path';
import './envConfig.js';

// =============================================================================
// AUDIO TOOL — Supports multiple backends:
//   1. OpenAI Whisper + ElevenLabs (if API keys are set)
//   2. Gemini audio (if GOOGLE_API_KEY is set, no extra keys needed)
//   3. Graceful fallback with clear error messages
// =============================================================================

let openai = null;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

// Lazy-init OpenAI only if key exists
async function getOpenAI() {
    if (openai) return openai;
    if (!process.env.OPENAI_API_KEY) return null;
    const { default: OpenAI } = await import('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return openai;
}

// --- SPEECH TO TEXT ---
export async function transcribeAudio(args) {
    const { filePath } = args;
    console.log(`🎙️ Transcribing: ${filePath}`);

    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

    // Strategy 1: OpenAI Whisper (if key available)
    const client = await getOpenAI();
    if (client) {
        try {
            const transcription = await client.audio.transcriptions.create({
                file: fs.createReadStream(filePath),
                model: "whisper-1",
            });
            return transcription.text;
        } catch (error) {
            console.warn(`[Audio] Whisper failed: ${error.message}, falling back to Gemini...`);
        }
    }

    // Strategy 2: Gemini audio transcription (uses GOOGLE_API_KEY — no extra key)
    if (process.env.GOOGLE_API_KEY) {
        try {
            const { GoogleGenAI } = await import('@google/genai');
            const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
            const audioBuffer = fs.readFileSync(filePath);
            const base64Audio = audioBuffer.toString('base64');

            // Determine MIME type from extension
            const ext = path.extname(filePath).toLowerCase();
            const mimeMap = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webm': 'audio/webm', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg' };
            const mimeType = mimeMap[ext] || 'audio/webm';

            const response = await genai.models.generateContent({
                model: "gemini-2.0-flash",
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { inlineData: { data: base64Audio, mimeType } },
                            { text: 'Transcribe this audio accurately. Return ONLY the transcribed text, nothing else.' }
                        ]
                    }
                ]
            });

            return response.candidates[0].content.parts[0].text;
        } catch (error) {
            return `Error transcribing with Gemini: ${error.message}`;
        }
    }

    return "Error: No transcription backend available. Set OPENAI_API_KEY or GOOGLE_API_KEY.";
}

// --- TEXT TO SPEECH ---
export async function generateSpeech(args) {
    const { text, voiceId } = args;
    console.log(`🗣️ Generating Speech for: "${text.substring(0, 20)}..."`);

    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const outputPath = path.join(tempDir, `speech-${Date.now()}.mp3`);

    // Strategy 1: ElevenLabs (if key available)
    if (ELEVENLABS_API_KEY) {
        const voice = voiceId || DEFAULT_VOICE_ID;
        const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice}`;

        try {
            const { default: fetch } = await import('node-fetch');
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Accept': 'audio/mpeg',
                    'xi-api-key': ELEVENLABS_API_KEY,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: text,
                    model_id: "eleven_monolingual_v1",
                    voice_settings: { stability: 0.5, similarity_boost: 0.5 }
                }),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`ElevenLabs API Error: ${errText}`);
            }

            const buffer = Buffer.from(await response.arrayBuffer());
            fs.writeFileSync(outputPath, buffer);
            return outputPath;
        } catch (error) {
            console.warn(`[Audio] ElevenLabs failed: ${error.message}, falling back...`);
        }
    }

    // Strategy 2: Return text for client-side Web Speech API (zero cost, zero keys)
    // The frontend will use window.speechSynthesis to speak this text
    return JSON.stringify({ fallback: 'web-speech-api', text: text });
}
