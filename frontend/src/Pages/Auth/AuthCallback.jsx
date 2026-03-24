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

        completeGoogleSignIn({
            email,
            name: searchParams.get('name') || '',
            preferredName: searchParams.get('preferredName') || '',
            titlePreference: searchParams.get('titlePreference') || 'Sir',
        });

        navigate('/home', { replace: true });
    }, [searchParams, completeGoogleSignIn, navigate]);

    return null;
};

export default AuthCallback;
