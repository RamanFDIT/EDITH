import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Logo from '../../assets/EDITH.svg?react';
import BackButton from '../../components/BackButton/BackButton.jsx';
import Button from '../../components/Button/Button.jsx';
import { validateName } from '../../utils/profanityFilter.js';
import { useApp } from '../../context/AppContext.jsx';
import styles from './UserSetup.module.css';

const TITLE_OPTIONS = [
    { value: 'Sir', label: 'Sir' },
    { value: "Ma'am", label: "Ma'am" },
    { value: 'name', label: 'Just my name' },
];

const UserSetup = () => {
    const navigate = useNavigate();
    const { updateUserPreferences, setOnboardingComplete } = useApp();
    const [name, setName] = useState('');
    const [title, setTitle] = useState(null);
    const [error, setError] = useState(null);
    const [touched, setTouched] = useState(false);

    const handleNameChange = (e) => {
        const val = e.target.value;
        setName(val);
        if (touched) {
            const result = validateName(val);
            setError(result.error);
        }
    };

    const handleBlur = () => {
        setTouched(true);
        const result = validateName(name);
        setError(result.error);
    };

    const isValid = validateName(name).valid && title !== null;

    const handleNext = async () => {
        if (!isValid) return;
        await updateUserPreferences(name.trim(), title);
        setOnboardingComplete(true);
        navigate('/home');
    };

    return (
        <section className={styles.mainSection}>
            <div className={styles.container}>
                <div className={styles.logoRow}>
                    <BackButton />
                    <Logo className={styles.logo} />
                </div>
                <div className={styles.questionContainer}>
                    <p className={styles.question}>What should E.D.I.T.H. call you?</p>
                    <div>
                        <input
                            type="text"
                            className={styles.nameInput}
                            placeholder="Enter your name"
                            value={name}
                            onChange={handleNameChange}
                            onBlur={handleBlur}
                            maxLength={20}
                            autoFocus
                        />
                        {error && <p className={styles.errorText}>{error}</p>}
                    </div>
                    <div className={styles.titleSection}>
                        <p className={styles.titleLabel}>How should E.D.I.T.H. address you?</p>
                        <div className={styles.titleOptions}>
                            {TITLE_OPTIONS.map((opt) => (
                                <button
                                    key={opt.value}
                                    className={title === opt.value ? styles.titleOptionSelected : styles.titleOption}
                                    onClick={() => setTitle(opt.value)}
                                    type="button"
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                <Button disabled={!isValid} label="Next" onClick={handleNext} />
            </div>
        </section>
    );
};

export default UserSetup;
