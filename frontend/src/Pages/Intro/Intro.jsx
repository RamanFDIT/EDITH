import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import Button from '../../components/Button/Button.jsx'
import { useApp } from '../../context/AppContext.jsx';
import styles from './Intro.module.css';

const Intro = () => {
    const navigate = useNavigate();
    const { signInWithGoogle } = useApp();
    const [signingIn, setSigningIn] = useState(false);
    const [error, setError] = useState('');

    const handleSignIn = async () => {
        setSigningIn(true);
        setError('');
        try {
            const result = await signInWithGoogle();
            // If returning user with preferences already set, go straight to home
            if (result.preferredName) {
                navigate('/home');
            } else {
                navigate('/user-setup');
            }
        } catch (err) {
            if (err.message !== 'Sign-in window closed') {
                setError('Sign-in failed. Please try again.');
            }
        } finally {
            setSigningIn(false);
        }
    };

    return (
        <section className = {styles.mainSection}>
            <div className = {styles.container}>
                <h1 className = {styles.header}>E.D.I.T.H.</h1>
                <p className = {styles.description}>Engineered as an intelligent AI agent, EDITH automates complex project management tasks across Jira, GitHub, Slack, and Google Calendar. It streamlines developer workflows, transforming fragmented toolchains into a unified system.</p>
                {error && <p className={styles.error}>{error}</p>}
                <Button
                    label={signingIn ? "Signing in..." : "Sign in with Google"}
                    onClick={handleSignIn}
                    disabled={signingIn}
                />
            </div>
        </section>
    );
};

export default Intro;
