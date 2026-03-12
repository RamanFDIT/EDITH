import styles from './ChatHuman.module.css';

const ChatHuman = ({ message }) => {
  return (
    <div className={styles.messageContainer}>
      <div className={styles.bubble}>
        {message}
      </div>
    </div>
  );
};

export default ChatHuman;
