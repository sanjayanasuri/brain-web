import React, { useState, useEffect } from 'react';
import { listCalendarEvents, type CalendarEvent } from '@/app/api-client';
import GlassCard from '../ui/GlassCard';

interface DayEventsListProps {
    selectedDate: Date | null;
}

export default function DayEventsList({ selectedDate }: DayEventsListProps) {
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [loading, setLoading] = useState(false);

    const formatDate = (date: Date): string => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const formatTime = (timeStr: string | null | undefined): string => {
        if (!timeStr) return '';
        // Handle both "HH:MM" and full datetime formats
        const time = timeStr.includes('T') ? timeStr.split('T')[1] : timeStr;
        const [hours, minutes] = time.split(':');
        const hour = parseInt(hours, 10);
        const ampm = hour >= 12 ? 'pm' : 'am';
        const displayHour = hour % 12 || 12;
        return `${displayHour}:${minutes || '00'}${ampm}`;
    };

    useEffect(() => {
        async function loadEvents() {
            if (!selectedDate) {
                setEvents([]);
                return;
            }

            try {
                setLoading(true);
                const dateStr = formatDate(selectedDate);
                const response = await listCalendarEvents({ start_date: dateStr, end_date: dateStr });
                // Sort events by time
                const sortedEvents = response.events.sort((a: CalendarEvent, b: CalendarEvent) => {
                    const aTime = a.start_time || '00:00';
                    const bTime = b.start_time || '00:00';
                    return aTime.localeCompare(bTime);
                });
                setEvents(sortedEvents);
            } catch (err) {
                console.error('Failed to load day events:', err);
                setEvents([]);
            } finally {
                setLoading(false);
            }
        }
        loadEvents();
    }, [selectedDate]);

    if (!selectedDate) {
        return (
            <GlassCard style={{ maxHeight: '400px', overflowY: 'auto', padding: '16px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: 'var(--ink)' }}>
                    Day Events
                </h3>
                <div style={{ color: 'var(--muted)', fontSize: '13px', padding: '8px' }}>
                    Click on a date to see events
                </div>
            </GlassCard>
        );
    }

    const dayName = selectedDate.toLocaleDateString('en-US', { weekday: 'long' });
    const dateStr = selectedDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    return (
        <GlassCard style={{ maxHeight: '400px', overflowY: 'auto', padding: '16px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px', color: 'var(--ink)' }}>
                {dayName}
            </h3>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '16px' }}>
                {dateStr}
            </div>
            {loading ? (
                <div style={{ color: 'var(--muted)', fontSize: '13px', padding: '8px' }}>Loading...</div>
            ) : events.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: '13px', padding: '8px', fontStyle: 'italic' }}>No events for this day</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {events.map((event) => (
                        <div
                            key={event.event_id}
                            style={{
                                padding: '12px',
                                borderRadius: '8px',
                                border: '1px solid var(--border)',
                                background: 'var(--background)',
                                borderLeft: `4px solid ${event.color || 'var(--accent)'}`,
                            }}
                        >
                            <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--ink)', marginBottom: '4px' }}>
                                {event.title}
                            </div>
                            {!event.all_day && (event.start_time || event.end_time) && (
                                <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
                                    {formatTime(event.start_time)}
                                    {event.end_time && ` - ${formatTime(event.end_time)}`}
                                </div>
                            )}
                            {event.all_day && (
                                <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
                                    All day
                                </div>
                            )}
                            {event.location && (
                                <div style={{ fontSize: '11px', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span>📍</span>
                                    <span>{event.location}</span>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </GlassCard>
    );
}
