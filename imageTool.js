import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import './envConfig.js';
import { getValidToken } from './oauthService.js';

// Lazy-init: only create the client when actually needed, and support both OAuth and API key
let _ai = null;
let _aiMode = null; // 'oauth' or 'apikey'

async function getGenAI() {
  // Strategy 1: Google OAuth (primary — no API key needed from user)
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    try {
      const accessToken = await getValidToken('google');
      if (accessToken) {
        _ai = new GoogleGenAI({
          auth: {
            addAuthHeaders: async (headers) => {
              headers.set('Authorization', `Bearer ${accessToken}`);
            }
          }
        });
        _aiMode = 'oauth';
        return _ai;
      }
    } catch (e) {
      console.warn(`[Image] OAuth token retrieval failed: ${e.message}, falling back to API key...`);
    }
  }

  // Strategy 2: API key (bundled or user-provided — fallback)
  if (process.env.GOOGLE_API_KEY) {
    if (!_ai || _aiMode !== 'apikey') {
      _ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
      _aiMode = 'apikey';
    }
    return _ai;
  }

  return null;
}

// --- NANO BANANA (Gemini Image Generation) ---
export async function generateImage(args) {
    const { prompt, aspectRatio } = args;
    console.log(`🎨 Generating image (Nano Banana): "${prompt.substring(0, 50)}..."`);

    const ai = await getGenAI();
    if (!ai) {
        return "Image generation (Nano Banana) requires a Google connection. " +
               "Note: GitHub Models (GPT-4o) does not yet support image generation endpoints. " +
               "Please connect your Google account in Settings, or ensure a GOOGLE_API_KEY is available in your environment.";
    }

    // Models to try in order of preference
    const models = ["gemini-2.0-flash-preview-image-generation", "gemini-2.5-flash"];

    for (const model of models) {
        try {
            const config = {};
            if (aspectRatio) {
                config.imageConfig = { aspectRatio };
            }

            console.log(`🎨 Trying model: ${model} (auth: ${_aiMode})`);

            const response = await ai.models.generateContent({
                model,
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
                console.warn(`🎨 Model ${model} returned no content (reason: ${reason}). Trying next...`);
                continue; // Try next model
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
                    console.log(`🎨 Image saved: ${filePath} (model: ${model}, auth: ${_aiMode})`);
                }
            }

            if (!imageSaved) {
                console.warn(`🎨 Model ${model} responded but no image data. Trying next...`);
                continue;
            }

            return JSON.stringify({
                success: true,
                localUrl: `/temp/${filename}`,
                caption: captionText || null,
                message: `Image generated and saved. Display it with: [IMAGE:/temp/${filename}]`,
            });
        } catch (error) {
            const msg = error.message || '';
            console.error(`🎨 Model ${model} failed:`, msg);

            // Rate limit — don't try more models, it affects the whole API
            if (msg.includes('429') || msg.includes('quota') || msg.includes('rate')) {
                return "Image generation is temporarily rate-limited. The free tier allows limited requests per minute. Please wait a moment and try again.";
            }
            // Auth failure
            if (msg.includes('401') || msg.includes('403') || msg.includes('PERMISSION_DENIED')) {
                return "Image generation authentication failed. Please reconnect your Google account in Settings, or check that your API key has Gemini access enabled.";
            }
            // Safety filter
            if (msg.includes('SAFETY') || msg.includes('blocked')) {
                return `Image generation was blocked by safety filters. Try rephrasing your prompt to avoid sensitive content.`;
            }
            // Other error — try next model
            continue;
        }
    }

    return "Image generation failed with all available models. Please ensure your Google account is connected in Settings, or try again later.";
}

