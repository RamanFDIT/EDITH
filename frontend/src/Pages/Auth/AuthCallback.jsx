import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../../context/AppContext.jsx';

const AuthCallback = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { completeGoogleSignIn } = useApp();

    useEffect(() => {
        const email = searchParams.get('email');
        if (!email) {
            navigate('/auth', { replace: true });
            return;
        }

        const preferredName = searchParams.get('preferredName') || '';
        const titlePreference = searchParams.get('titlePreference') || 'Sir';

        completeGoogleSignIn({
            email,
            name: searchParams.get('name') || '',
            preferredName,
            titlePreference,
        });

        // New users (no preferred name set yet) go through setup first
        if (!preferredName) {
            navigate('/setup', { replace: true });
        } else {
            navigate('/home', { replace: true });
        }
    }, [searchParams, completeGoogleSignIn, navigate]);

    return null;
};

export default AuthCallback;
