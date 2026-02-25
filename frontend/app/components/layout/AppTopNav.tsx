'use client';

import { usePathname, useRouter } from 'next/navigation';

type NavItem = { label: string; href: string };

const DEFAULT_ITEMS: NavItem[] = [
  { label: 'Home', href: '/home' },
  { label: 'Explorer', href: '/explorer' },
  { label: 'Quiz Me', href: '/learn' },
  { label: 'Reader', href: '/web-reader' },
  { label: 'Profile', href: '/profile-customization' },
];

export default function AppTopNav({ items = DEFAULT_ITEMS }: { items?: NavItem[] }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {items.map((item) => {
        const active = pathname?.startsWith(item.href);
        return (
          <button
            key={item.href}
            className="ui-button"
            onClick={() => router.push(item.href)}
            style={active ? { borderColor: 'var(--ink)', fontWeight: 600 } : undefined}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
