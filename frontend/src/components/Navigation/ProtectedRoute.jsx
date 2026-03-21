import { Navigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';

export const ProtectedRoute = ({ children }) => {
    const { isAuthenticated, authLoading } = useApp();

    if (authLoading) return null;

    if (!isAuthenticated) {
        return <Navigate to="/" replace />;
    }

    return children;
};
