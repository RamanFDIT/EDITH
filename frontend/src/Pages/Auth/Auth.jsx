import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext.jsx';
import styles from './Auth.module.css';

const Auth = () => {
    const navigate = useNavigate();
    const { signIn, register, signInWithGoogle } = useApp();

    const [isSignUp, setIsSignUp] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (isSignUp) {
                await register(email, password);
            } else {
                await signIn(email, password);
            }
            navigate('/home');
        } catch (err) {
            setError(err.message || 'Authentication failed');
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleSignIn = async () => {
        setError('');
        setLoading(true);
        try {
            await signInWithGoogle();
            navigate('/home');
        } catch (err) {
            if (err.message !== 'Sign-in window closed') {
                setError('Google sign-in failed. Please try again.');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <section className={styles.mainSection}>
            <div className={styles.container}>
                <h1 className={styles.logo}>E.D.I.T.H.</h1>
                <h2 className={styles.title}>
                    {isSignUp ? 'Create account' : 'Welcome back'}
                </h2>

                <form className={styles.form} onSubmit={handleSubmit}>
                    <div className={styles.inputGroup}>
                        <label className={styles.label} htmlFor="email">Email</label>
                        <input
                            id="email"
                            type="email"
                            className={styles.input}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            required
                            autoComplete="email"
                        />
                    </div>

                    <div className={styles.inputGroup}>
                        <label className={styles.label} htmlFor="password">Password</label>
                        <div className={styles.passwordWrapper}>
                            <input
                                id="password"
                                type={showPassword ? 'text' : 'password'}
                                className={styles.input}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder={isSignUp ? 'Min 6 characters' : 'Enter password'}
                                required
                                minLength={6}
                                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                            />
                            <button
                                type="button"
                                className={styles.togglePassword}
                                onClick={() => setShowPassword(v => !v)}
                                tabIndex={-1}
                            >
                                {showPassword ? 'Hide' : 'Show'}
                            </button>
                        </div>
                    </div>

                    {error && <p className={styles.error}>{error}</p>}

                    <button
                        type="submit"
                        className={styles.primaryButton}
                        disabled={loading}
                    >
                        {loading ? 'Please wait...' : isSignUp ? 'Create account' : 'Sign in'}
                    </button>
                </form>

                <div className={styles.divider}>
                    <span className={styles.dividerLine} />
                    <span className={styles.dividerText}>or</span>
                    <span className={styles.dividerLine} />
                </div>

                <button
                    className={styles.googleButton}
                    onClick={handleGoogleSignIn}
                    disabled={loading}
                >
                    <svg className={styles.googleIcon} viewBox="0 0 24 24" width="20" height="20">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    {isSignUp ? 'Sign up with Google' : 'Sign in with Google'}
                </button>

                <p className={styles.switchMode}>
                    {isSignUp ? 'Already have an account?' : "Don't have an account?"}
                    {' '}
                    <button
                        className={styles.switchButton}
                        onClick={() => { setIsSignUp(v => !v); setError(''); }}
                    >
                        {isSignUp ? 'Sign in' : 'Create one'}
                    </button>
                </p>
            </div>
        </section>
    );
};

export default Auth;
