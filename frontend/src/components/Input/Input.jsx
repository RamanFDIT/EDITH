import { useRef } from 'react';
import { Send, Paperclip, X } from 'lucide-react';
import styles from './Input.module.css';

const Input = ({ value, onChange, onSubmit, disabled, files, onFilesChange }) => {
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

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

  return (
    <div className={styles.inputWrapper}>
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
          disabled={disabled}
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
          disabled={disabled}
        />
        <button
          className={styles.sendButton}
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
};

export default Input;
