import { useRef, useState, useCallback, useEffect } from 'react';
import { Send, Paperclip, Mic, X, Volume2, VolumeX, Square } from 'lucide-react';
import styles from './Input.module.css';

const Input = ({ value, onChange, onSubmit, disabled, files, onFilesChange, onAudioSubmit, isStreaming, onCancel, voiceEnabled, onVoiceToggle }) => {
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
    };
  }, []);

  // Auto-focus textarea when user types anywhere on the page
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      // Skip if modifier keys are held (don't hijack Ctrl+C, etc.)
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      // Skip non-printable keys (arrows, Escape, Tab, function keys, etc.)
      if (e.key.length !== 1) return;

      // Skip if textarea is disabled
      if (textareaRef.current?.disabled) return;

      // Skip if user is already typing in another input/textarea
      const active = document.activeElement;
      const tag = active?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || active?.isContentEditable) return;

      // Focus the textarea — the browser will naturally insert the character
      textareaRef.current?.focus();
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Cancel stream on Escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isStreaming && onCancel) {
        onCancel();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isStreaming, onCancel]);

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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        },
      });

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
        if (maxVolume > 35) {
          lastAudioTimeRef.current = Date.now();
        }
        // Auto-stop after 2.5 seconds of silence
        if (Date.now() - lastAudioTimeRef.current > 2500) {
          if (stopRecordingRef.current) stopRecordingRef.current();
          return;
        }
        animationFrameRef.current = requestAnimationFrame(detectSilence);
      };
      detectSilence();

      setLiveTranscription('Listening...');

      // -----------------------------------------------------------------------
      // MEDIA RECORDER — collect audio blobs for backend transcription
      // -----------------------------------------------------------------------
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      const mediaRecorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 });
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

        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size === 0) {
            setLiveTranscription('');
            return;
        }

        setLiveTranscription('Transcribing...');
        if (onAudioSubmit) {
            onAudioSubmit(blob);
        }
      };

      mediaRecorder.start(250);
      setIsRecording(true);

    } catch (err) {
      console.error('[Voice] Microphone access denied or Error:', err);
    }
  }, [onAudioSubmit]);

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

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className={styles.hiddenFileInput}
        onChange={handleFileSelect}
      />

      <div className={styles.inputCard}>
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
        <div className={styles.inputActions}>
          <div className={styles.actionsLeft}>
            <button
              className={styles.attachButton}
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || isRecording}
              title="Attach files"
            >
              <Paperclip size={18} />
            </button>
            {onVoiceToggle && (
              <button
                className={`${styles.voiceToggle} ${voiceEnabled ? styles.voiceOn : ''}`}
                onClick={onVoiceToggle}
                title={voiceEnabled ? "Mute voice responses" : "Enable voice responses"}
              >
                {voiceEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
              </button>
            )}
          </div>
          <div className={styles.actionsRight}>
            <button
              className={`${styles.micButton} ${isRecording ? styles.micRecording : ''}`}
              onClick={toggleRecording}
              disabled={disabled}
              title={isRecording ? 'Stop recording' : 'Voice input'}
            >
              <Mic size={18} />
            </button>
            {isStreaming ? (
              <button
                className={`${styles.sendButton} ${styles.cancelButton}`}
                onClick={onCancel}
                title="Cancel response (Esc)"
              >
                <Square size={16} />
              </button>
            ) : (
              <button
                className={styles.sendButton}
                onClick={onSubmit}
                disabled={disabled || isRecording || !value.trim()}
              >
                <Send size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Input;