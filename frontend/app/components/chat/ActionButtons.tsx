"use client";

import { useRouter } from "next/navigation";

interface Action {
    type: 'view_graph' | 'add_to_profile' | 'open_url';
    label: string;
    graph_id?: string;
    url?: string;
    interest?: string;
}

interface ActionButtonsProps {
    actions: Action[];
}

export function ActionButtons({ actions }: ActionButtonsProps) {
    const router = useRouter();

    const handleAction = (action: Action) => {
        if (action.type === 'view_graph' && action.graph_id) {
            // Navigate to graph view
            router.push(`/explorer?graph_id=${action.graph_id}`);
        } else if (action.type === 'add_to_profile') {
            // Profile already updated by backend, just show confirmation
            console.log(`Added ${action.interest} to profile`);
        } else if (action.type === 'open_url' && action.url) {
            window.open(action.url, '_blank');
        }
    };

    if (!actions || actions.length === 0) {
        return null;
    }

    return (
        <div style={{
            display: 'flex',
            gap: '8px',
            marginTop: '12px',
            flexWrap: 'wrap'
        }}>
            {actions.map((action, idx) => (
                <button
                    key={idx}
                    onClick={() => handleAction(action)}
                    style={{
                        padding: '8px 16px',
                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '12px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        boxShadow: '0 2px 8px rgba(102, 126, 234, 0.3)'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = '0 2px 8px rgba(102, 126, 234, 0.3)';
                    }}
                >
                    {action.label}
                </button>
            ))}
        </div>
    );
}
