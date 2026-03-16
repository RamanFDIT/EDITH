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
  const recognitionRef = useRef(null);
  const stopRecordingRef = useRef(null);

  const onSubmitRef = useRef(onSubmit);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscription, setLiveTranscription] = useState('');

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
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (e) {}
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

      // -----------------------------------------------------------------------
      // LIVE TRANSCRIPTION — Use Web Speech API directly (no Deepgram needed)
      // -----------------------------------------------------------------------
      setLiveTranscription('');
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition && !recognitionRef.current) {
        try {
          const recognition = new SpeechRecognition();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = 'en-US';

          let finalTranscript = '';
          recognition.onresult = (event) => {
            let interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
              } else {
                interimTranscript += event.results[i][0].transcript;
              }
            }
            setLiveTranscription(finalTranscript + interimTranscript);
          };
          recognition.onerror = (e) => {
            if (e.error !== 'network') {
                console.log('[Voice] Recognition error:', e.error);
            }
          };

          recognitionRef.current = recognition;
          recognition.start();
        } catch (e) {
          console.log('[Voice] Live transcription failed to start:', e);
        }
      }

      // -----------------------------------------------------------------------
      // MEDIA RECORDER — collect audio blobs for Gemini transcription
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

        // Stop live transcription
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch (e) {}
          recognitionRef.current = null;
        }
        setLiveTranscription('');

        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size === 0) return;

        // Upload to /api/voice — now returns SSE stream
        const formData = new FormData();
        formData.append('audio', blob, `voice-${Date.now()}.webm`);

        try {
          const res = await fetch('http://localhost:3000/api/voice', {
            method: 'POST',
            body: formData,
          });

          if (!res.ok) {
            console.error('[Voice] Server returned error:', res.status);
            return;
          }

          // Pass the SSE stream to the parent (Home.jsx) so it can render in chat
          if (onVoiceStream) {
            onVoiceStream(res.body);
          }
        } catch (err) {
          console.error('[Voice] Upload failed:', err);
        }
      };

      mediaRecorder.start(250);
      setIsRecording(true);

    } catch (err) {
      console.error('[Voice] Microphone access denied or Error:', err);
    }
  }, [onVoiceStream]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
      recognitionRef.current = null;
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
          disabled={disabled || isRecording}
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
          placeholder="Ask E.D.I.T.H. anything..."
          disabled={disabled || isRecording}
        />
        <button
          className={`${styles.micButton} ${isRecording ? styles.micRecording : ''}`}
          onClick={toggleRecording}
          disabled={disabled}
          title={isRecording ? 'Stop recording' : 'Voice input'}
        >
          <Mic size={18} />
        </button>
        <button
          className={styles.sendButton}
          onClick={onSubmit}
          disabled={disabled || isRecording || !value.trim()}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
};

export default Input;
