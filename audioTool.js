import fs from 'fs';
import path from 'path';
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

    return `Error: No transcription backend available. env.API_KEY=${!!process.env.GOOGLE_API_KEY}, env.REFRESH=${!!process.env.GOOGLE_REFRESH_TOKEN}`;
}

// --- TEXT TO SPEECH (Edge TTS — zero API keys) ---
export async function generateSpeech(args) {
    const { text, voiceId } = args;
    console.log(`🗣️ Generating Speech for: "${text.substring(0, 40)}..."`);

    // Strategy 1: Edge TTS (Microsoft neural voices — free, no API key)
    try {
        const { Communicate } = await import('edge-tts-universal');
        const voice = voiceId || DEFAULT_EDGE_VOICE;
        const communicate = new Communicate(text, { voice });

        // Collect audio chunks and write to file
        const audioChunks = [];
        for await (const chunk of communicate.stream()) {
            if (chunk.type === 'audio' && chunk.data) {
                audioChunks.push(chunk.data);
            }
        }

        if (audioChunks.length > 0) {
            const audioBuffer = Buffer.concat(audioChunks);
            const base64Audio = audioBuffer.toString('base64');
            console.log(`🗣️ Edge TTS audio generated (voice: ${voice})`);
            return `data:audio/mp3;base64,${base64Audio}`;
        } else {
            throw new Error('No audio data received from Edge TTS');
        }
    } catch (error) {
        console.warn(`[Audio] Edge TTS failed: ${error.message}, falling back to Web Speech API...`);
    }

    // Strategy 2: Return text for client-side Web Speech API (zero cost, zero keys)
    // The frontend will use window.speechSynthesis to speak this text
    return JSON.stringify({ fallback: 'web-speech-api', text: text });
}

