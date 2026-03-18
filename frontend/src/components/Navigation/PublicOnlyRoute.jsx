import { Navigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';

export const PublicOnlyRoute = ({ children }) => {
    const { onboardingComplete } = useApp();

    if (onboardingComplete) {
        return <Navigate to="/home" replace />;
    }

    return children;
};
