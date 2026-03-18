import { Navigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';

export const ProtectedRoute = ({ children }) => {
    const { onboardingComplete } = useApp();

    if (!onboardingComplete) {
        return <Navigate to="/" replace />;
    }

    return children;
};
