import { useRef, useState, useCallback, useEffect } from 'react';
import { Send, Paperclip, Mic, X } from 'lucide-react';
import styles from './Input.module.css';

const Input = ({ value, onChange, onSubmit, disabled, files, onFilesChange, onVoiceStream }) => {
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  // AudioContext refs for silence detection
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const lastAudioTimeRef = useRef(Date.now());
  const stopRecordingRef = useRef(null);
  
  // Whisper Worker Ref
  const workerRef = useRef(null);
  const [isModelReady, setIsModelReady] = useState(false);

  const onSubmitRef = useRef(onSubmit);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscription, setLiveTranscription] = useState('');

  // Initialize Worker
  useEffect(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('../../workers/whisperWorker.js', import.meta.url), {
        type: 'module'
      });
      
      workerRef.current.addEventListener('message', (e) => {
        switch (e.data.status) {
          case 'ready':
            setIsModelReady(true);
            setLiveTranscription('');
            break;
          case 'progress':
            setLiveTranscription(`Loading local AI Model...`);
            break;
          case 'complete':
            setLiveTranscription('');
            if (e.data.output && e.data.output.text) {
               const text = e.data.output.text.trim();
               if (text && onSubmitRef.current) {
                   onSubmitRef.current(text);
               }
            }
            break;
          case 'error':
            console.error('[Whisper] Worker Error:', e.data.error);
            setLiveTranscription('');
            break;
        }
      });
      // Trigger load immediately in background
      workerRef.current.postMessage({ action: 'load' });
    }
  }, []);

  useEffect(() => {
    onSubmitRef.current = onSubmit;
    onChangeRef.current = onChange;
    valueRef.current = value;
  }, [onSubmit, onChange, value]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !disabled) {
      e.preventDefault();
      onSubmit();
    }
  };

  const handleChange = (e) => {
    onChange(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = e.target.scrollHeight + 'px';
  };

  const handleFileSelect = (e) => {
    const selected = Array.from(e.target.files);
    if (selected.length > 0) {
      onFilesChange(prev => [...prev, ...selected]);
    }
    e.target.value = '';
  };

  const removeFile = (index) => {
    onFilesChange(prev => prev.filter((_, i) => i !== index));
  };

  // --- Voice Recording ---
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Setup AudioContext for silence detection
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      analyser.minDecibels = -60;
      analyser.fftSize = 256;
      const microphone = audioContext.createMediaStreamSource(stream);
      microphone.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      lastAudioTimeRef.current = Date.now();

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const detectSilence = () => {
        analyser.getByteFrequencyData(dataArray);
        let maxVolume = 0;
        for (let i = 0; i < dataArray.length; i++) {
          if (dataArray[i] > maxVolume) maxVolume = dataArray[i];
        }
        if (maxVolume > 15) {
          lastAudioTimeRef.current = Date.now();
        }
        // Auto-stop after 2 seconds of silence
        if (Date.now() - lastAudioTimeRef.current > 2000) {
          if (stopRecordingRef.current) stopRecordingRef.current();
          return;
        }
        animationFrameRef.current = requestAnimationFrame(detectSilence);
      };
      detectSilence();

      setLiveTranscription('Listening...');

      // -----------------------------------------------------------------------
      // MEDIA RECORDER — collect audio blobs for local processing
      // -----------------------------------------------------------------------
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        // Release microphone
        stream.getTracks().forEach(t => t.stop());

        // Clean up AudioContext
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        if (audioContext && audioContext.state !== 'closed') audioContext.close();

        setLiveTranscription('Transcribing (Local)...');

        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size === 0) {
            setLiveTranscription('');
            return;
        }

        try {
            // Decode blob to Float32Array at 16000Hz required by Whisper
            const arrayBuffer = await blob.arrayBuffer();
            const decodeContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            const audioBuffer = await decodeContext.decodeAudioData(arrayBuffer);
            const float32Array = audioBuffer.getChannelData(0);
            
            // Send to Web Worker
            if (workerRef.current) {
                workerRef.current.postMessage({ audio: float32Array });
            }
        } catch (err) {
            console.error('[Whisper] Decode error:', err);
            setLiveTranscription('');
        }
      };

      mediaRecorder.start(250);
      setIsRecording(true);

    } catch (err) {
      console.error('[Voice] Microphone access denied or Error:', err);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setIsRecording(false);
  }, []);

  // Keep stopRecording accessible from the silence detector closure
  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  return (
    <div className={styles.inputWrapper}>
      {/* Live transcription banner — shown while recording */}
      {isRecording && (
        <div className={styles.liveTranscriptBanner}>
          <span className={styles.liveTranscriptDot} />
          <span className={styles.liveTranscriptText}>
            {liveTranscription || 'Listening…'}
          </span>
        </div>
      )}

      {files && files.length > 0 && (
        <div className={styles.fileChips}>
          {files.map((file, i) => (
            <span key={i} className={styles.fileChip}>
              {file.name}
              <button onClick={() => removeFile(i)} className={styles.fileChipRemove}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className={styles.inputContainer}>
        <button
          className={styles.attachButton}
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || isRecording || !isModelReady}
          title="Attach files"
        >
          <Paperclip size={18} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className={styles.hiddenFileInput}
          onChange={handleFileSelect}
        />
        <textarea
          ref={textareaRef}
          rows={1}
          className={styles.input}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={isModelReady ? "Ask E.D.I.T.H. anything..." : "Loading STT model..."}
          disabled={disabled || isRecording || !isModelReady}
        />
        <button
          className={`${styles.micButton} ${isRecording ? styles.micRecording : ''}`}
          onClick={toggleRecording}
          disabled={disabled || !isModelReady}
          title={isRecording ? 'Stop recording' : 'Voice input'}
        >
          <Mic size={18} />
        </button>
        <button
          className={styles.sendButton}
          onClick={onSubmit}
          disabled={disabled || isRecording || !value.trim() || !isModelReady}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
};

export default Input;