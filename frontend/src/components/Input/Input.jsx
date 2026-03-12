import { useRef } from 'react';
import { Send } from 'lucide-react';
import styles from './Input.module.css';

const Input = ({ value, onChange, onSubmit, disabled }) => {
  const textareaRef = useRef(null);

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

  return (
    <div className={styles.inputContainer}>
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
  );
};

export default Input;
