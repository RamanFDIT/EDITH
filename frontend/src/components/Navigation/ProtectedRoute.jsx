import { Navigate, useLocation } from 'react-router-dom';
import { useApp } from '../../context/AppContext';

export const ProtectedRoute = ({ children }) => {
    const { isAuthenticated, authLoading, onboardingComplete } = useApp();
    const location = useLocation();

    if (authLoading) return null;

    if (!isAuthenticated) {
        return <Navigate to="/" replace />;
    }

    // Redirect to setup if onboarding isn't complete (but don't redirect if already on /setup)
    if (!onboardingComplete && location.pathname !== '/setup') {
        return <Navigate to="/setup" replace />;
    }

    return children;
};
