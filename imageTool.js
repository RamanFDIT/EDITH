import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import './envConfig.js';

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

// --- NANO BANANA (Gemini 2.5 Flash Image Generation) ---
export async function generateImage(args) {
    const { prompt, aspectRatio } = args;
    console.log(`🎨 Generating image (Nano Banana): "${prompt.substring(0, 50)}..."`);

    if (!process.env.GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY not found.");

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
