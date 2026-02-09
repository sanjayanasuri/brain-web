
import React, { Component } from 'react';

interface SlashCommandListProps {
    items: any[];
    command: (item: any) => void;
}

interface SlashCommandListState {
    selectedIndex: number;
}

export class SlashCommandList extends Component<SlashCommandListProps, SlashCommandListState> {
    state: SlashCommandListState = {
        selectedIndex: 0,
    };

    componentDidUpdate(prevProps: SlashCommandListProps) {
        if (prevProps.items !== this.props.items) {
            this.setState({ selectedIndex: 0 });
        }
    }

    onKeyDown({ event }: { event: KeyboardEvent }) {
        if (event.key === 'ArrowUp') {
            this.upHandler();
            return true;
        }

        if (event.key === 'ArrowDown') {
            this.downHandler();
            return true;
        }

        if (event.key === 'Enter') {
            this.enterHandler();
            return true;
        }

        return false;
    }

    upHandler() {
        this.setState({
            selectedIndex:
                (this.state.selectedIndex + this.props.items.length - 1) % this.props.items.length,
        });
    }

    downHandler() {
        this.setState({
            selectedIndex: (this.state.selectedIndex + 1) % this.props.items.length,
        });
    }

    enterHandler() {
        this.selectItem(this.state.selectedIndex);
    }

    selectItem(index: number) {
        const item = this.props.items[index];

        if (item) {
            this.props.command(item);
        }
    }

    render() {
        const { items } = this.props;

        if (items.length === 0) {
            return null;
        }

        return (
            <div
                className="slash-command-list"
                style={{
                    background: 'var(--surface)',
                    borderRadius: '8px',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                    border: '1px solid var(--border)',
                    padding: '8px',
                    maxHeight: '300px',
                    overflowY: 'auto',
                    minWidth: '240px',
                }}
            >
                {items.map((item, index) => (
                    <button
                        className={`slash-command-item ${index === this.state.selectedIndex ? 'is-selected' : ''}`}
                        key={index}
                        onClick={() => this.selectItem(index)}
                        onMouseEnter={() => this.setState({ selectedIndex: index })}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            width: '100%',
                            padding: '8px 12px',
                            border: 'none',
                            background: index === this.state.selectedIndex ? 'var(--panel)' : 'transparent',
                            textAlign: 'left',
                            cursor: 'pointer',
                            borderRadius: '4px',
                            gap: '12px',
                        }}
                    >
                        {/* Optional Icon Placeholder */}
                        {/* <div style={{width: 20, height: 20, background: '#eee', borderRadius: 3}}></div> */}

                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--ink)' }}>{item.title}</span>
                            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{item.description}</span>
                        </div>
                    </button>
                ))}
            </div>
        );
    }
}
