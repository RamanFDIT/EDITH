import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import styles from './BackButton.module.css';

const BackButton = () => {
    const navigate = useNavigate();
    return (
        <button className={styles.backButton} onClick={() => navigate(-1)}>
            <ArrowLeft size={20} />
            <span>Back</span>
        </button>
    );
};

export default BackButton;
