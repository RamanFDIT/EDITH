import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
    try {
        const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
        const dummyBase64 = Buffer.from('dummy').toString('base64');
        const mimeType = 'audio/webm';
        
        console.log("Testing with structured contents (role/parts)...");
        try {
            await genai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { inlineData: { data: dummyBase64, mimeType } },
                            { text: 'Transcribe this audio accurately.' }
                        ]
                    }
                ]
            });
            console.log("Structured contents SUCCESS");
        } catch(e) { console.error("Structured contents ERROR:", e.message); }

        console.log("\nTesting with array contents...");
        try {
            await genai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: [
                    { inlineData: { data: dummyBase64, mimeType } },
                    'Transcribe this audio accurately.'
                ]
            });
            console.log("Array contents SUCCESS");
        } catch(e) { console.error("Array contents ERROR:", e.message); }

    } catch (err) {
        console.error("FATAL:", err.message);
    }
}
test();
