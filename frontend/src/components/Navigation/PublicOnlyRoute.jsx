import { Navigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';

export const PublicOnlyRoute = ({ children }) => {
    const { isAuthenticated, authLoading } = useApp();

    if (authLoading) return null;

    if (isAuthenticated) {
        return <Navigate to="/home" replace />;
    }

    return children;
};
