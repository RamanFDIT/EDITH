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

// Default voice: British female to match EDITH personality
const DEFAULT_EDGE_VOICE = "en-GB-SoniaNeural";

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
            let genai;
            if (process.env.GOOGLE_REFRESH_TOKEN) {
              // OAuth mode — preferred
              const accessToken = await getValidToken('google');
              if (accessToken) {
                genai = new GoogleGenAI({
                  auth: {
                    addAuthHeaders: async (headers) => {
                      headers.set('Authorization', `Bearer ${accessToken}`);
                    }
                  }
                });
              }
            }
            if (!genai && process.env.GOOGLE_API_KEY) {
              genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
            }

            if (genai) {
              const response = await genai.models.generateContent({
                  model: "gemini-2.5-flash",
                  contents: [
                      { inlineData: { data: base64Audio, mimeType } },
                      'Transcribe this audio accurately. Return ONLY the transcribed text, nothing else.'
                  ]
              });
              return response.candidates[0].content.parts[0].text;
            }
        } catch (error) {
            console.warn(`[Audio] Gemini transcription failed: ${error.message}`);
            
            // If OAuth failed due to insufficient scopes, try falling back to the bundled API key
            if (error.message && error.message.includes('403') && process.env.GOOGLE_API_KEY) {
                console.log(`[Audio] Falling back to GOOGLE_API_KEY for transcription due to OAuth scope error...`);
                try {
                    const { GoogleGenAI } = await import('@google/genai');
                    const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

                    const response = await genai.models.generateContent({
                        model: "gemini-2.5-flash",
                        contents: [
                            { inlineData: { data: base64Audio, mimeType } },
                            'Transcribe this audio accurately. Return ONLY the transcribed text, nothing else.'
                        ]
                    });
                    return response.candidates[0].content.parts[0].text;
                } catch (fallbackError) {
                    console.error(`[Audio] Fallback to API key also failed:`, fallbackError.message);
                    return `Error: Gemini transcription failed (OAuth & API Key both rejected) - ${fallbackError.message}`;
                }
            }

            return `Error: Gemini transcription failed - ${error.message}`;
        }
    }

    return `Error: No transcription backend available. ` +
           `Note: GitHub Models (GPT-4o) does not yet support audio transcription. ` +
           `Please connect your Google account in Settings to enable Gemini-based transcription.`;
}

// --- TEXT TO SPEECH (Supports ElevenLabs & Edge TTS) ---
export async function generateSpeech(args) {
    const { text, voiceId } = args;
    console.log(`🗣️ Generating Speech for: "${text.substring(0, 40)}..."`);

    // Strategy 1: Edge TTS via node-edge-tts (Microsoft neural voices — free, no API key)
    try {
        const { EdgeTTS } = await import('node-edge-tts');
        const voice = voiceId || DEFAULT_EDGE_VOICE;
        
        // node-edge-tts requires writing to a file, so we use a temp file
        const tempPath = path.join(os.tmpdir(), `edith-tts-${Date.now()}.mp3`);
        
        const tts = new EdgeTTS({
            voice: voice,
            lang: 'en-GB',
            outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
        });

        await tts.ttsPromise(text, tempPath);

        // Read the generated file into a buffer
        if (fs.existsSync(tempPath)) {
            const audioBuffer = await fs.promises.readFile(tempPath);
            const base64Audio = audioBuffer.toString('base64');
            
            // Clean up temp file
            fs.promises.unlink(tempPath).catch(e => console.warn('Failed to delete temp TTS file:', e));
            
            console.log(`🗣️ Edge TTS audio generated (voice: ${voice})`);
            return `data:audio/mp3;base64,${base64Audio}`;
        } else {
            throw new Error('TTS file was not created');
        }
    } catch (error) {
        console.warn(`[Audio] Edge TTS failed: ${error.message}. Falling back to ElevenLabs TTS...`);
    }

    // Strategy 2: ElevenLabs (High quality — requires API key)
    if (process.env.ELEVENLABS_API_KEY) {
        try {
            const { ElevenLabsClient } = await import('elevenlabs');
            const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
            
            console.log(`🗣️ Using ElevenLabs TTS (Voice: ${voiceId || 'JBFqnCBv7zXP0t9NvYI8 (Sonia)'})`);
            const audio = await client.generate({
                voice: voiceId || "JBFqnCBv7zXP0t9NvYI8", // Default to Sonia or a known good voice
                text: text,
                model_id: "eleven_multilingual_v2"
            });

            // Convert Stream to Buffer for base64
            const chunks = [];
            for await (const chunk of audio) {
                chunks.push(chunk);
            }
            const audioBuffer = Buffer.concat(chunks);
            const base64Audio = audioBuffer.toString('base64');
            console.log(`✅ ElevenLabs audio generated`);
            return `data:audio/mp3;base64,${base64Audio}`;

        } catch (error) {
            console.warn(`[Audio] ElevenLabs TTS failed: ${error.message}. Falling back to Web Speech API...`);
        }
    }

    // Strategy 3: Return text for client-side Web Speech API (zero cost, zero keys)
    return JSON.stringify({ fallback: 'web-speech-api', text: text });
}
