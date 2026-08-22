import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';

export function ProtectedRoute({ children }) {
  const { session, loading } = useAuth();
  const { t } = useI18n();
  if (loading) return <div className="centered muted">{t('common.loading')}</div>;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}
