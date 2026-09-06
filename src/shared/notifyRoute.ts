export function screenForNotification(
  type: string,
  role?: string | null,
): { name: string; params?: Record<string, string> } | null {
  const t = type.toLowerCase();
  if (t === 'session') {
    if (role === 'volunteer') return { name: 'Tabs', params: { tab: 'live' } };
    if (role === 'student') return { name: 'Scanner' };
    return { name: 'Notifications' };
  }
  if (t === 'excuse') {
    if (role === 'volunteer') return { name: 'Tabs', params: { tab: 'inbox' } };
    if (role === 'student') return { name: 'Excuses' };
    return { name: 'Notifications' };
  }
  if (t === 'cert') return role === 'student' ? { name: 'Certificates' } : { name: 'Notifications' };
  if (t === 'badge' || t === 'league' || t === 'streak') {
    return role === 'student' ? { name: 'Achievements' } : { name: 'Notifications' };
  }
  return { name: 'Notifications' };
}
