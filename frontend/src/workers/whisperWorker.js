import { pipeline, env } from "@huggingface/transformers";

// Optional: Ensure models are downloaded and cached correctly in the browser
env.allowLocalModels = false;

class TranscriptionPipeline {
  static task = 'automatic-speech-recognition';
  static model = 'Xenova/whisper-tiny.en';
  static instance = null;

  static async getInstance(progress_callback = null) {
    if (this.instance === null) {
      // Using pipeline to load the model
      this.instance = pipeline(this.task, this.model, { 
        progress_callback,
        // device: 'webgpu' can be added if you want to try GPU acceleration
      });
    }
    return this.instance;
  }
}

// Listen for messages from the main thread
self.onmessage = async (event) => {
  const { audio, action } = event.data;

  if (action === 'load') {
      try {
          await TranscriptionPipeline.getInstance((progress) => {
              self.postMessage({ status: 'progress', data: progress });
          });
          self.postMessage({ status: 'ready' });
      } catch (err) {
          self.postMessage({ status: 'error', error: err.message });
      }
      return;
  }

  if (audio) {
      try {
          const transcriber = await TranscriptionPipeline.getInstance();
          
          // Transcribe the 16kHz Float32Array audio
          const output = await transcriber(audio, {
              chunk_length_s: 30,
              stride_length_s: 5,
          });

          self.postMessage({ status: 'complete', output });
      } catch (err) {
          self.postMessage({ status: 'error', error: err.message });
      }
  }
};
