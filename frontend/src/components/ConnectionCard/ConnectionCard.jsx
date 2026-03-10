import styles from './ConnectionCard.module.css';
import Button from '../../components/Button/Button.jsx'

const ConnectionCard = ({ cardHead, onConnect }) => {
    return(
        <div className={styles.connectionContainer}>
            <h3 className={styles.cardHead}>{cardHead}</h3>
            <Button label="Connect" onClick={onConnect} />
        </div>
    );
};

export default ConnectionCard;