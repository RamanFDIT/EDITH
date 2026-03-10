import styles from './QuestionOption.module.css';

const QuestionOption = ({ label, checked, disabled, onChange }) => {
    return(
        <label className={styles.questionContainer}>
            <span className={styles.label}>{label}</span>
            <input 
            checked={checked} 
            disabled={disabled} 
            onChange={onChange} 
            name={label} 
            type="checkbox" 
            className={disabled ? styles.checkboxDisabled : styles.checkbox} />
        </label>
    );
};

export default QuestionOption;