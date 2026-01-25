import React, { useState, useEffect } from 'react';
import { listCalendarEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, type CalendarEvent } from '@/app/api-client';
import Button from '../ui/Button';
import GlassCard from '../ui/GlassCard';
import EventModal from './EventModal';

interface CalendarWidgetProps {
    selectedDate: Date | null;
    onDateSelect: (date: Date | null) => void;
}

export default function CalendarWidget({
    selectedDate,
    onDateSelect
}: CalendarWidgetProps) {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
    const [showEventModal, setShowEventModal] = useState(false);
    const [loading, setLoading] = useState(false);
    const [view, setView] = useState<'month' | 'day' | 'week'>('month');

    const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
    const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay();

    const today = new Date();
    const isToday = (day: number) => {
        return currentDate.getFullYear() === today.getFullYear() &&
            currentDate.getMonth() === today.getMonth() &&
            day === today.getDate();
    };

    // Format date as YYYY-MM-DD
    const formatDate = (date: Date): string => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // Load events based on current view
    useEffect(() => {
        async function loadEvents() {
            try {
                setLoading(true);
                let startDate: string;
                let endDate: string;

                if (view === 'month') {
                    const year = currentDate.getFullYear();
                    const month = currentDate.getMonth();
                    startDate = formatDate(new Date(year, month, 1));
                    endDate = formatDate(new Date(year, month + 1, 0));
                } else if (view === 'day') {
                    const date = selectedDate || currentDate;
                    startDate = formatDate(date);
                    endDate = formatDate(date);
                } else { // week
                    const date = selectedDate || currentDate;
                    const startOfWeek = new Date(date);
                    startOfWeek.setDate(date.getDate() - date.getDay());
                    const endOfWeek = new Date(startOfWeek);
                    endOfWeek.setDate(startOfWeek.getDate() + 6);
                    startDate = formatDate(startOfWeek);
                    endDate = formatDate(endOfWeek);
                }

                const response = await listCalendarEvents({ start_date: startDate, end_date: endDate });
                setEvents(response.events);
            } catch (err) {
                console.error('Failed to load calendar events:', err);
            } finally {
                setLoading(false);
            }
        }
        loadEvents();
    }, [currentDate, view, selectedDate]);

    // Get events for a specific day
    const getEventsForDay = (day: number): CalendarEvent[] => {
        const dateStr = formatDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), day));
        return events.filter(event => {
            const eventStart = event.start_date;
            const eventEnd = event.end_date || event.start_date;
            return dateStr >= eventStart && dateStr <= eventEnd;
        });
    };

    // Get events for a specific date
    const getEventsForDate = (date: Date): CalendarEvent[] => {
        const dateStr = formatDate(date);
        return events.filter(event => {
            const eventStart = event.start_date;
            const eventEnd = event.end_date || event.start_date;
            return dateStr >= eventStart && dateStr <= eventEnd;
        }).sort((a, b) => {
            // Sort by time if available
            const aTime = a.start_time || '00:00';
            const bTime = b.start_time || '00:00';
            return aTime.localeCompare(bTime);
        });
    };

    // Get week dates
    const getWeekDates = (): Date[] => {
        const date = selectedDate || currentDate;
        const startOfWeek = new Date(date);
        startOfWeek.setDate(date.getDate() - date.getDay());
        const weekDates: Date[] = [];
        for (let i = 0; i < 7; i++) {
            const day = new Date(startOfWeek);
            day.setDate(startOfWeek.getDate() + i);
            weekDates.push(day);
        }
        return weekDates;
    };

    const handlePrev = () => {
        if (view === 'month') {
            setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
        } else if (view === 'day') {
            const date = selectedDate || currentDate;
            const newDate = new Date(date);
            newDate.setDate(date.getDate() - 1);
            onDateSelect(newDate);
        } else { // week
            const date = selectedDate || currentDate;
            const newDate = new Date(date);
            newDate.setDate(date.getDate() - 7);
            onDateSelect(newDate);
        }
    };

    const handleNext = () => {
        if (view === 'month') {
            setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
        } else if (view === 'day') {
            const date = selectedDate || currentDate;
            const newDate = new Date(date);
            newDate.setDate(date.getDate() + 1);
            onDateSelect(newDate);
        } else { // week
            const date = selectedDate || currentDate;
            const newDate = new Date(date);
            newDate.setDate(date.getDate() + 7);
            onDateSelect(newDate);
        }
    };

    const handleToday = () => {
        const today = new Date();
        setCurrentDate(today);
        onDateSelect(today);
    };

    const handleDateClick = (day: number) => {
        const clickedDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
        onDateSelect(clickedDate);
        if (view === 'month') {
            // In month view, clicking a date shows events for that day
            // Don't open modal, just select the date
        } else {
            // In day/week view, clicking opens event modal
            setEditingEvent(null);
            setShowEventModal(true);
        }
    };

    const handleEventClick = (e: React.MouseEvent, event: CalendarEvent) => {
        e.stopPropagation();
        setEditingEvent(event);
        const eventDate = new Date(event.start_date);
        onDateSelect(eventDate);
        setShowEventModal(true);
    };

    const handleSaveEvent = async (eventData: { title: string; description?: string; location?: string; all_day?: boolean; start_time?: string; end_time?: string; color?: string }) => {
        const dateToUse = selectedDate || currentDate;
        if (!dateToUse) return;

        try {
            setLoading(true);
            const startDate = formatDate(dateToUse);

            if (editingEvent) {
                await updateCalendarEvent(editingEvent.event_id, {
                    title: eventData.title,
                    description: eventData.description || null,
                    location: eventData.location || null,
                    start_date: startDate,
                    all_day: eventData.all_day !== false,
                    start_time: eventData.start_time || null,
                    end_time: eventData.end_time || null,
                    color: eventData.color || null,
                });
            } else {
                await createCalendarEvent({
                    title: eventData.title,
                    description: eventData.description || null,
                    location: eventData.location || null,
                    start_date: startDate,
                    all_day: eventData.all_day !== false,
                    start_time: eventData.start_time || null,
                    end_time: eventData.end_time || null,
                    color: eventData.color || null,
                });
            }

            // Reload events
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth();
            const startDateRange = formatDate(new Date(year, month, 1));
            const endDateRange = formatDate(new Date(year, month + 1, 0));
            // Note: This optimization (reloading only month) might miss events if we switched views, 
            // but simplistic approach for now calling the same logic as useEffect will trigger re-fetch basically

            // Force reload by toggling a dummy state or just let the user see the update on next interactions?
            // Better to manually udpate the local state or re-fetch.
            // Re-fetching the current view:
            const response = await listCalendarEvents({
                start_date: view === 'month' ? formatDate(new Date(year, month, 1)) : formatDate(selectedDate || currentDate),
                end_date: view === 'month' ? formatDate(new Date(year, month + 1, 0)) : formatDate(selectedDate || currentDate) // simplified
            });
            // Actually simpler to just rely on the existing useEffect if we depend on a refresh trigger, 
            // but for now let's just re-fetch properly based on current view variables which are in scope.
            // Copy-paste logic from useEffect is messy. 
            // Instead, we'll just re-trigger the effect by updating a 'lastUpdated' state if we wanted, 
            // but here we can just do a quick fetch for the current month/view.

            // Let's just re-fetch broadly for the month to be safe
            const r = await listCalendarEvents({
                start_date: formatDate(new Date(year, month, 1)),
                end_date: formatDate(new Date(year, month + 1, 0))
            });
            setEvents(r.events);

            setShowEventModal(false);
            setEditingEvent(null);
        } catch (err) {
            console.error('Failed to save event:', err);
            alert(`Failed to save event.`);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteEvent = async (eventId: string) => {
        if (!confirm('Are you sure you want to delete this event?')) return;

        try {
            setLoading(true);
            await deleteCalendarEvent(eventId);

            // Re-fetch
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth();
            const r = await listCalendarEvents({
                start_date: formatDate(new Date(year, month, 1)),
                end_date: formatDate(new Date(year, month + 1, 0))
            });
            setEvents(r.events);

            setShowEventModal(false);
            setEditingEvent(null);
        } catch (err) {
            console.error('Failed to delete event:', err);
            alert('Failed to delete event.');
        } finally {
            setLoading(false);
        }
    };

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayNamesFull = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const getHeaderText = () => {
        const date = selectedDate || currentDate;
        if (view === 'day') {
            return `${dayNamesFull[date.getDay()]}, ${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
        } else if (view === 'week') {
            const weekDates = getWeekDates();
            const start = weekDates[0];
            const end = weekDates[6];
            if (start.getMonth() === end.getMonth()) {
                return `${monthNames[start.getMonth()]} ${start.getDate()} - ${end.getDate()}, ${start.getFullYear()}`;
            } else {
                return `${monthNames[start.getMonth()]} ${start.getDate()} - ${monthNames[end.getMonth()]} ${end.getDate()}, ${start.getFullYear()}`;
            }
        } else {
            return `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
        }
    };

    return (
        <GlassCard style={{ padding: '20px', overflow: 'hidden' }}>
            {/* View Toggle */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', background: 'var(--background)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                {(['month', 'week', 'day'] as const).map((v) => (
                    <button
                        key={v}
                        onClick={() => {
                            setView(v);
                            if (v === 'day' && !selectedDate) {
                                onDateSelect(currentDate);
                            }
                        }}
                        style={{
                            flex: 1,
                            padding: '6px 12px',
                            background: view === v ? 'var(--surface)' : 'transparent',
                            color: view === v ? 'var(--ink)' : 'var(--muted)',
                            border: view === v ? '1px solid var(--border)' : '1px solid transparent',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: 600,
                            textTransform: 'capitalize',
                            boxShadow: view === v ? '0 2px 4px rgba(0,0,0,0.05)' : 'none',
                            transition: 'all 0.2s ease',
                        }}
                    >
                        {v}
                    </button>
                ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <Button variant="ghost" size="sm" onClick={handlePrev}>←</Button>
                <div style={{ fontSize: '15px', fontWeight: '700', color: 'var(--ink)', fontFamily: 'var(--font-display)' }}>
                    {getHeaderText()}
                </div>
                <Button variant="ghost" size="sm" onClick={handleNext}>→</Button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
                <Button variant="secondary" size="sm" onClick={handleToday}>Today</Button>
            </div>

            {/* Calendar grid */}
            <div style={{ marginBottom: '16px', overflow: 'hidden' }}>
                {view === 'month' && (
                    <>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '8px' }}>
                            {dayNames.map(day => (
                                <div key={day} style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)', textAlign: 'center', padding: '4px' }}>
                                    {day}
                                </div>
                            ))}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                            {Array.from({ length: firstDayOfMonth }).map((_, idx) => (
                                <div key={`empty-${idx}`} style={{ aspectRatio: '1' }} />
                            ))}
                            {Array.from({ length: daysInMonth }).map((_, idx) => {
                                const day = idx + 1;
                                const dayEvents = getEventsForDay(day);
                                const dayDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
                                const isSelected = selectedDate && formatDate(dayDate) === formatDate(selectedDate);
                                const isDayToday = isToday(day);

                                return (
                                    <div
                                        key={day}
                                        onClick={() => handleDateClick(day)}
                                        style={{
                                            aspectRatio: '1',
                                            padding: '4px',
                                            borderRadius: '8px',
                                            cursor: 'pointer',
                                            background: isDayToday ? 'var(--accent)' : isSelected ? 'var(--surface)' : 'transparent',
                                            color: isDayToday ? 'white' : 'var(--ink)',
                                            fontSize: '12px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            border: isSelected && !isDayToday ? '1px solid var(--accent)' : '1px solid transparent',
                                            transition: 'all 0.2s ease',
                                        }}
                                        className={!isDayToday && !isSelected ? "hover:bg-black/5 dark:hover:bg-white/5" : ""}
                                    >
                                        <div style={{ fontWeight: isDayToday || isSelected ? 600 : 400, marginBottom: '2px' }}>{day}</div>
                                        {dayEvents.length > 0 && (
                                            <div style={{
                                                display: 'flex',
                                                gap: '2px',
                                                flexWrap: 'wrap',
                                                justifyContent: 'center',
                                                width: '100%',
                                            }}>
                                                {dayEvents.slice(0, 3).map((event) => (
                                                    <div
                                                        key={event.event_id}
                                                        style={{
                                                            width: '4px',
                                                            height: '4px',
                                                            borderRadius: '50%',
                                                            background: isDayToday ? 'white' : (event.color || 'var(--accent)'),
                                                        }}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}

                {view === 'week' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {getWeekDates().map((date, idx) => {
                            const dateEvents = getEventsForDate(date);
                            const isSelected = selectedDate && formatDate(date) === formatDate(selectedDate);
                            const isTodayDate = formatDate(date) === formatDate(today);
                            return (
                                <div
                                    key={idx}
                                    onClick={() => {
                                        onDateSelect(date);
                                        setEditingEvent(null);
                                        setShowEventModal(true);
                                    }}
                                    style={{
                                        padding: '12px',
                                        borderRadius: '12px',
                                        border: '1px solid var(--border)',
                                        background: isSelected ? 'var(--surface)' : isTodayDate ? 'var(--accent)' : 'transparent',
                                        color: isTodayDate ? 'white' : 'var(--ink)',
                                        cursor: 'pointer',
                                    }}
                                >
                                    <div style={{ fontSize: '12px', fontWeight: '600', marginBottom: '8px' }}>
                                        {dayNamesFull[date.getDay()]}, {date.getDate()}
                                    </div>
                                    {dateEvents.length > 0 && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            {dateEvents.map((event) => (
                                                <div
                                                    key={event.event_id}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleEventClick(e, event);
                                                    }}
                                                    style={{
                                                        fontSize: '11px',
                                                        padding: '6px 8px',
                                                        borderRadius: '6px',
                                                        background: event.color || 'var(--accent)',
                                                        color: 'white',
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        gap: '6px',
                                                        alignItems: 'center',
                                                    }}
                                                >
                                                    <span style={{ opacity: 0.8 }}>{event.start_time?.substring(0, 5)}</span>
                                                    <span style={{ fontWeight: 500 }}>{event.title}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {view === 'day' && (() => {
                    const date = selectedDate || currentDate;
                    const dateEvents = getEventsForDate(date);
                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {dateEvents.length === 0 ? (
                                <div style={{
                                    padding: '32px',
                                    textAlign: 'center',
                                    color: 'var(--muted)',
                                    fontSize: '13px',
                                    border: '1px dashed var(--border)',
                                    borderRadius: '12px',
                                }}>
                                    No events today
                                </div>
                            ) : (
                                dateEvents.map((event) => (
                                    <div
                                        key={event.event_id}
                                        onClick={(e) => handleEventClick(e, event)}
                                        style={{
                                            padding: '12px',
                                            borderRadius: '12px',
                                            border: '1px solid var(--border)',
                                            background: 'var(--surface)',
                                            cursor: 'pointer',
                                            borderLeft: `4px solid ${event.color || 'var(--accent)'}`,
                                            transition: 'transform 0.2s',
                                        }}
                                        className="hover:translate-x-1"
                                    >
                                        <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '4px', color: 'var(--ink)' }}>
                                            {event.title}
                                        </div>
                                        <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: 'var(--muted)' }}>
                                            {!event.all_day && event.start_time && (
                                                <span>🕒 {event.start_time.substring(0, 5)} - {event.end_time?.substring(0, 5)}</span>
                                            )}
                                            {event.location && (
                                                <span>📍 {event.location}</span>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    setEditingEvent(null);
                                    setShowEventModal(true);
                                }}
                                style={{ marginTop: '8px', borderStyle: 'dashed' }}
                            >
                                + Add Event
                            </Button>
                        </div>
                    );
                })()}
            </div>

            <Button
                variant="secondary"
                onClick={() => alert('External calendar integration coming soon!')}
                style={{ width: '100%', fontSize: '12px' }}
            >
                Connect External Calendar
            </Button>

            {showEventModal && (
                <EventModal
                    selectedDate={selectedDate || currentDate}
                    event={editingEvent}
                    onSave={handleSaveEvent}
                    onDelete={editingEvent ? () => handleDeleteEvent(editingEvent.event_id) : undefined}
                    onClose={() => {
                        setShowEventModal(false);
                        setEditingEvent(null);
                    }}
                    loading={loading}
                />
            )}
        </GlassCard>
    );
}
