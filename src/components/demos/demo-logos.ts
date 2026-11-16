import type { IconName } from '@/lib/icons';

export const logos = [
  { name: 'Northwind Labs', icon: 'zap' },
  { name: 'Lumen Works', icon: 'globe' },
  { name: 'Fernhill', icon: 'users' },
  { name: 'Quartz & Co', icon: 'shield' },
  { name: 'Brightwave', icon: 'chart' },
  { name: 'Oakline', icon: 'lock' },
] satisfies { name: string; icon: IconName }[];
