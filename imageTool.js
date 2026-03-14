import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import './envConfig.js';
import { getValidToken } from './oauthService.js';

// Lazy-init: only create the client when actually needed, and support both API key and OAuth
let _ai = null;
let _aiMode = null; // 'apikey' or 'oauth'

async function getGenAI() {
  if (process.env.GOOGLE_API_KEY) {
    // API key mode — stable, create once
    if (!_ai || _aiMode !== 'apikey') {
      _ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
      _aiMode = 'apikey';
    }
    return _ai;
  }

  if (process.env.GOOGLE_REFRESH_TOKEN) {
    // OAuth mode — get a fresh access token and inject via httpOptions headers
    const accessToken = await getValidToken('google');
    if (!accessToken) return null;
    _ai = new GoogleGenAI({
      apiKey: 'OAUTH_MODE', // Placeholder — Bearer header takes priority on the backend
      httpOptions: { headers: { 'Authorization': `Bearer ${accessToken}` } },
    });
    _aiMode = 'oauth';
    return _ai;
  }

  return null;
}

// --- NANO BANANA (Gemini 2.5 Flash Image Generation) ---
export async function generateImage(args) {
    const { prompt, aspectRatio } = args;
    console.log(`🎨 Generating image (Nano Banana): "${prompt.substring(0, 50)}..."`);

    const ai = await getGenAI();
    if (!ai) throw new Error("No Google AI credentials available. Connect your Google account or set GOOGLE_API_KEY.");

    try {
        const config = {};
        if (aspectRatio) {
            config.imageConfig = { aspectRatio };
        }

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-image",
            contents: prompt,
            config: {
                responseModalities: ['Text', 'Image'],
                ...config,
            },
        });

        // Validate response structure
        const candidate = response.candidates?.[0];
        if (!candidate || !candidate.content?.parts?.length) {
            const reason = candidate?.finishReason || 'unknown';
            console.error(`🎨 Image generation returned no content. Finish reason: ${reason}`);
            return `Image generation failed — the model returned no content (reason: ${reason}). The prompt may have been blocked by safety filters. Try rephrasing.`;
        }

        // Save to temp/
        const tempDir = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const filename = `image-${Date.now()}.png`;
        const filePath = path.join(tempDir, filename);
        let captionText = "";
        let imageSaved = false;

        for (const part of candidate.content.parts) {
            if (part.text) {
                captionText += part.text;
            } else if (part.inlineData) {
                const buffer = Buffer.from(part.inlineData.data, "base64");
                fs.writeFileSync(filePath, buffer);
                imageSaved = true;
                console.log(`🎨 Image saved: ${filePath}`);
            }
        }

        if (!imageSaved) {
            console.error("🎨 Model responded but did not produce an image.");
            return captionText
                ? `The model did not generate an image, but responded with: ${captionText}`
                : `Image generation failed — the model did not return any image data. Try a more descriptive prompt.`;
        }

        return JSON.stringify({
            success: true,
            localUrl: `/temp/${filename}`,
            caption: captionText || null,
            message: `Image generated and saved. Display it with: [IMAGE:/temp/${filename}]`,
        });
    } catch (error) {
        console.error("Image generation error:", error);
        return `Error generating image: ${error.message}`;
    }
}
