import { Navigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';

export const PublicOnlyRoute = ({ children }) => {
    const { isAuthenticated, authLoading, onboardingComplete } = useApp();

    // Don't redirect while session is being validated
    if (authLoading) return null;

    if (isAuthenticated && onboardingComplete) {
        return <Navigate to="/home" replace />;
    }

    return children;
};
