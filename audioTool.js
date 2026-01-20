import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import fetch from 'node-fetch'; // Standard fetch for ElevenLabs if needed, or use SDK
import './envConfig.js';

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, // This is the default and can be omitted
});

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
// Default Voice ID (Rachel) - can be parameterized
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; 

// --- WHISPER (Speech to Text) ---
export async function transcribeAudio(args) {
    const { filePath } = args;
    console.log(`🎙️ Transcribing: ${filePath}`);

    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not found.");
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

    try {
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model: "whisper-1",
        });

        return transcription.text;
    } catch (error) {
        return `Error transcribing audio: ${error.message}`;
    }
}

// --- ELEVENLABS (Text to Speech) ---
export async function generateSpeech(args) {
    const { text, voiceId } = args;
    console.log(`🗣️ Generating Speech for: "${text.substring(0, 20)}..."`);

    if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not found.");

    const voice = voiceId || DEFAULT_VOICE_ID;
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice}`;

    try {
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
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.5,
                }
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`ElevenLabs API Error: ${errText}`);
        }

        // Save the audio file
        const buffer = await response.buffer();
        const fileName = `speech_${Date.now()}.mp3`;
        const outputPath = path.resolve(process.cwd(), fileName);
        
        fs.writeFileSync(outputPath, buffer);
        console.log(`💾 Audio saved to: ${outputPath}`);
        
        return outputPath;
    } catch (error) {
        return `Error generating speech: ${error.message}`;
    }
}
