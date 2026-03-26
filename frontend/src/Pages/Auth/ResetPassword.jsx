import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../../apiConfig.js';
import styles from './Auth.module.css';

const ResetPassword = () => {
    const navigate = useNavigate();
    const [step, setStep] = useState(1); // 1 = enter email, 2 = enter code + new password
    const [email, setEmail] = useState('');
    const [resetCode, setResetCode] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(false);
    const [generatedCode, setGeneratedCode] = useState('');

    const handleRequestCode = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Request failed');

            // For capstone demo: show the code directly
            if (data.resetCode) {
                setGeneratedCode(data.resetCode);
            }
            setStep(2);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleResetPassword = async (e) => {
        e.preventDefault();
        setError('');

        if (newPassword !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }
        if (newPassword.length < 6) {
            setError('Password must be at least 6 characters');
            return;
        }

        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/api/auth/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, resetCode, newPassword }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Reset failed');

            setSuccess('Password reset successful! Redirecting to sign in...');
            setTimeout(() => navigate('/auth'), 2000);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <section className={styles.mainSection}>
            <div className={styles.container}>
                <h1 className={styles.logo}>E.D.I.T.H.</h1>
                <h2 className={styles.title}>Reset Password</h2>

                {step === 1 ? (
                    <form className={styles.form} onSubmit={handleRequestCode}>
                        <div className={styles.inputGroup}>
                            <label className={styles.label} htmlFor="reset-email">Email</label>
                            <input
                                id="reset-email"
                                type="email"
                                className={styles.input}
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="you@example.com"
                                required
                                autoComplete="email"
                            />
                        </div>

                        {error && <p className={styles.error}>{error}</p>}

                        <button type="submit" className={styles.primaryButton} disabled={loading}>
                            {loading ? 'Please wait...' : 'Send Reset Code'}
                        </button>
                    </form>
                ) : (
                    <form className={styles.form} onSubmit={handleResetPassword}>
                        {generatedCode && (
                            <div style={{
                                background: 'rgba(0,255,136,0.1)',
                                border: '1px solid rgba(0,255,136,0.3)',
                                borderRadius: '8px',
                                padding: '12px 16px',
                                textAlign: 'center',
                                marginBottom: '4px'
                            }}>
                                <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px', margin: '0 0 4px' }}>
                                    Your reset code
                                </p>
                                <p style={{ color: '#00ff88', fontSize: '24px', fontWeight: 'bold', letterSpacing: '4px', margin: 0 }}>
                                    {generatedCode}
                                </p>
                            </div>
                        )}

                        <div className={styles.inputGroup}>
                            <label className={styles.label} htmlFor="reset-code">Reset Code</label>
                            <input
                                id="reset-code"
                                type="text"
                                className={styles.input}
                                value={resetCode}
                                onChange={(e) => setResetCode(e.target.value)}
                                placeholder="Enter 6-digit code"
                                required
                                maxLength={6}
                                autoComplete="one-time-code"
                            />
                        </div>

                        <div className={styles.inputGroup}>
                            <label className={styles.label} htmlFor="new-password">New Password</label>
                            <div className={styles.passwordWrapper}>
                                <input
                                    id="new-password"
                                    type={showPassword ? 'text' : 'password'}
                                    className={styles.input}
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder="Min 6 characters"
                                    required
                                    minLength={6}
                                    autoComplete="new-password"
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

                        <div className={styles.inputGroup}>
                            <label className={styles.label} htmlFor="confirm-password">Confirm Password</label>
                            <input
                                id="confirm-password"
                                type={showPassword ? 'text' : 'password'}
                                className={styles.input}
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="Re-enter password"
                                required
                                minLength={6}
                                autoComplete="new-password"
                            />
                        </div>

                        {error && <p className={styles.error}>{error}</p>}
                        {success && <p style={{ color: '#00ff88', fontSize: '14px', textAlign: 'center' }}>{success}</p>}

                        <button type="submit" className={styles.primaryButton} disabled={loading}>
                            {loading ? 'Please wait...' : 'Reset Password'}
                        </button>
                    </form>
                )}

                <p className={styles.switchMode}>
                    Remember your password?{' '}
                    <button className={styles.switchButton} onClick={() => navigate('/auth')}>
                        Sign in
                    </button>
                </p>
            </div>
        </section>
    );
};

export default ResetPassword;
