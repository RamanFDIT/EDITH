import styles from './Button.module.css';

const Button = ({ label, onClick, disabled }) => {
    return(
        <button disabled={disabled} className = {disabled ? styles.buttonDisabled : styles.buttonPrimary} onClick={onClick}>{label}</button>
    );
}

export default Button;