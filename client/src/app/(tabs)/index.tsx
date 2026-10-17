import { useTranslation } from 'react-i18next';

import { ComingSoon } from '@/screens/coming-soon';

export default function HomeScreen() {
  const { t } = useTranslation();
  return <ComingSoon title={t('tabs.home')} />;
}
