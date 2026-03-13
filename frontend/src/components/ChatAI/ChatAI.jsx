import { Cpu } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './ChatAI.module.css';

const ChatAI = ({ message, images }) => {
  // Strip [IMAGE:...] markers from the text since we render images separately
  const cleanMessage = message.replace(/\[IMAGE:[^\]]+\]/g, '').trim();

  return (
    <div className={styles.messageContainer}>
      <div className={styles.avatar}>
        <Cpu size={16} className={styles.avatarIcon} />
      </div>
      <div className={styles.bubble}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanMessage}</ReactMarkdown>
        {images && images.length > 0 && (
          <div className={styles.imageGrid}>
            {images.map((img, i) => (
              <div key={i} className={styles.imageWrapper}>
                <img
                  src={img.url}
                  alt={img.caption || 'Generated image'}
                  className={styles.generatedImage}
                />
                {img.caption && <p className={styles.imageCaption}>{img.caption}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatAI;
