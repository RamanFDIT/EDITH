import { Cpu } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './ChatAI.module.css';

const ChatAI = ({ message }) => {
  return (
    <div className={styles.messageContainer}>
      <div className={styles.avatar}>
        <Cpu size={16} className={styles.avatarIcon} />
      </div>
      <div className={styles.bubble}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message}</ReactMarkdown>
      </div>
    </div>
  );
};

export default ChatAI;
