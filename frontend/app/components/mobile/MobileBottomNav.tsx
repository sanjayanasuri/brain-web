'use client';

type Tab = 'concepts' | 'add' | 'search';

interface MobileBottomNavProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

export default function MobileBottomNav({ activeTab, onTabChange }: MobileBottomNavProps) {
  return (
    <nav style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      background: 'white',
      borderTop: '1px solid #e5e7eb',
      paddingBottom: 'env(safe-area-inset-bottom)',
      display: 'flex',
      justifyContent: 'space-around',
      alignItems: 'center',
      height: '64px',
      zIndex: 1000,
      boxShadow: '0 -2px 8px rgba(0,0,0,0.05)',
    }}>
      <button
        onClick={() => onTabChange('concepts')}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px',
          background: 'none',
          border: 'none',
          padding: '8px',
          cursor: 'pointer',
          color: activeTab === 'concepts' ? '#3b82f6' : '#6b7280',
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 700 }}>Learn</span>
        <span style={{ fontSize: '12px', fontWeight: activeTab === 'concepts' ? '600' : '400' }}>
          Concepts
        </span>
      </button>

      <button
        onClick={() => onTabChange('add')}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px',
          background: 'none',
          border: 'none',
          padding: '8px',
          cursor: 'pointer',
          color: activeTab === 'add' ? '#3b82f6' : '#6b7280',
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 700 }}>Add</span>
        <span style={{ fontSize: '12px', fontWeight: activeTab === 'add' ? '600' : '400' }}>
          Add
        </span>
      </button>

      <button
        onClick={() => onTabChange('search')}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px',
          background: 'none',
          border: 'none',
          padding: '8px',
          cursor: 'pointer',
          color: activeTab === 'search' ? '#3b82f6' : '#6b7280',
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 700 }}>Find</span>
        <span style={{ fontSize: '12px', fontWeight: activeTab === 'search' ? '600' : '400' }}>
          Search
        </span>
      </button>
    </nav>
  );
}

