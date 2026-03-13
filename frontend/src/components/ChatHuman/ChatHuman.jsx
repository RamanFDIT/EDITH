import { Paperclip } from 'lucide-react';
import styles from './ChatHuman.module.css';

const ChatHuman = ({ message, files }) => {
  return (
    <div className={styles.messageContainer}>
      <div className={styles.bubble}>
        {message}
        {files && files.length > 0 && (
          <div className={styles.fileList}>
            {files.map((name, i) => (
              <span key={i} className={styles.fileTag}>
                <Paperclip size={12} />
                {name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatHuman;
