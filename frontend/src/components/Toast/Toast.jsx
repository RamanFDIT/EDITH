import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import styles from './Toast.module.css';

const icons = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
};

const Toast = ({ message, type = 'info', duration = 5000, onClose }) => {
  const [exiting, setExiting] = useState(false);

  const handleClose = useCallback(() => {
    setExiting(true);
    setTimeout(() => onClose?.(), 300);
  }, [onClose]);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(handleClose, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, handleClose]);

  const Icon = icons[type] || icons.info;

  return (
    <div className={`${styles.toast} ${styles[type]} ${exiting ? styles.exit : ''}`}>
      <Icon size={18} className={styles.icon} />
      <span className={styles.message}>{message}</span>
      <button className={styles.closeBtn} onClick={handleClose}>
        <X size={14} />
      </button>
    </div>
  );
};

export const ToastContainer = ({ toasts, removeToast }) => (
  <div className={styles.container}>
    {toasts.map(t => (
      <Toast key={t.id} {...t} onClose={() => removeToast(t.id)} />
    ))}
  </div>
);

export default Toast;
