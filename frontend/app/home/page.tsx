'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getFocusAreas, listGraphs, type FocusArea, type GraphSummary, listCalendarEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, getLocationSuggestions, type CalendarEvent, type LocationSuggestion } from '../api-client';
import SessionDrawer from '../components/navigation/SessionDrawer';
import { fetchRecentSessions, type SessionSummary } from '../lib/eventsClient';
import { getChatSessions, setCurrentSessionId, createChatSession, addMessageToSession, type ChatSession } from '../lib/chatSessions';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

// Calendar Widget Component
function CalendarWidget({ 
  selectedDate, 
  onDateSelect 
}: { 
  selectedDate: Date | null;
  onDateSelect: (date: Date | null) => void;
}) {
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
      let startDateRange: string;
      let endDateRange: string;
      
      if (view === 'month') {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        startDateRange = formatDate(new Date(year, month, 1));
        endDateRange = formatDate(new Date(year, month + 1, 0));
      } else if (view === 'day') {
        const date = selectedDate || currentDate;
        startDateRange = formatDate(date);
        endDateRange = formatDate(date);
      } else { // week
        const date = selectedDate || currentDate;
        const startOfWeek = new Date(date);
        startOfWeek.setDate(date.getDate() - date.getDay());
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        startDateRange = formatDate(startOfWeek);
        endDateRange = formatDate(endOfWeek);
      }
      
      const response = await listCalendarEvents({ start_date: startDateRange, end_date: endDateRange });
      setEvents(response.events);
      
      setShowEventModal(false);
      setEditingEvent(null);
    } catch (err) {
      console.error('Failed to save event:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      alert(`Failed to save event: ${errorMessage}\n\nPlease check the browser console for more details.`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!confirm('Are you sure you want to delete this event?')) return;

    try {
      setLoading(true);
      await deleteCalendarEvent(eventId);
      
      // Reload events
      let startDateRange: string;
      let endDateRange: string;
      
      if (view === 'month') {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        startDateRange = formatDate(new Date(year, month, 1));
        endDateRange = formatDate(new Date(year, month + 1, 0));
      } else if (view === 'day') {
        const date = selectedDate || currentDate;
        startDateRange = formatDate(date);
        endDateRange = formatDate(date);
      } else { // week
        const date = selectedDate || currentDate;
        const startOfWeek = new Date(date);
        startOfWeek.setDate(date.getDate() - date.getDay());
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        startDateRange = formatDate(startOfWeek);
        endDateRange = formatDate(endOfWeek);
      }
      
      const response = await listCalendarEvents({ start_date: startDateRange, end_date: endDateRange });
      setEvents(response.events);
      
      setShowEventModal(false);
      setEditingEvent(null);
    } catch (err) {
      console.error('Failed to delete event:', err);
      alert('Failed to delete event. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleConnectCalendar = () => {
    // Placeholder for calendar integration
    alert('External calendar integration (Google Calendar, Apple Calendar, etc.) coming soon!');
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
    <div style={{
      background: 'var(--panel)',
      borderRadius: '12px',
      padding: '16px',
      border: '1px solid var(--border)',
      boxShadow: 'var(--shadow)',
      overflow: 'hidden',
      maxWidth: '100%',
    }}>
      {/* View Toggle */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
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
              padding: '6px 8px',
              background: view === v ? 'var(--accent)' : 'var(--surface)',
              color: view === v ? 'white' : 'var(--ink)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: '500',
              textTransform: 'capitalize',
            }}
          >
            {v}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <button
          onClick={handlePrev}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--ink)',
            padding: '4px 8px',
            borderRadius: '4px',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          ←
        </button>
        <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--ink)', textAlign: 'center', flex: 1 }}>
          {getHeaderText()}
        </div>
        <button
          onClick={handleNext}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--ink)',
            padding: '4px 8px',
            borderRadius: '4px',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          →
        </button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
        <button
          onClick={handleToday}
          style={{
            padding: '4px 12px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            color: 'var(--ink)',
            fontSize: '11px',
            cursor: 'pointer',
          }}
        >
          Today
        </button>
      </div>

      {/* Calendar grid */}
      <div style={{ marginBottom: '12px', overflow: 'hidden', maxWidth: '100%' }}>
        {view === 'month' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '4px', minWidth: 0 }}>
              {dayNames.map(day => (
                <div key={day} style={{ fontSize: '10px', color: 'var(--muted)', textAlign: 'center', padding: '2px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {day}
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '2px', minWidth: 0 }}>
              {Array.from({ length: firstDayOfMonth }).map((_, idx) => (
                <div key={`empty-${idx}`} style={{ aspectRatio: '1', padding: '2px', minWidth: 0 }} />
              ))}
              {Array.from({ length: daysInMonth }).map((_, idx) => {
                const day = idx + 1;
                const dayEvents = getEventsForDay(day);
                const dayDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
                const isSelected = selectedDate && formatDate(dayDate) === formatDate(selectedDate);
                return (
                  <div
                    key={day}
                    onClick={() => handleDateClick(day)}
                    style={{
                      aspectRatio: '1',
                      padding: '2px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      background: isToday(day) ? 'var(--accent)' : isSelected ? 'var(--surface)' : 'transparent',
                      color: isToday(day) ? 'white' : 'var(--ink)',
                      fontSize: '10px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      fontWeight: isToday(day) ? '600' : '400',
                      position: 'relative',
                      border: isSelected && !isToday(day) ? '2px solid var(--accent)' : 'none',
                      minWidth: 0,
                      overflow: 'hidden',
                      boxSizing: 'border-box',
                    }}
                    onMouseEnter={(e) => {
                      if (!isToday(day) && !isSelected) {
                        e.currentTarget.style.background = 'var(--surface)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isToday(day) && !isSelected) {
                        e.currentTarget.style.background = 'transparent';
                      }
                    }}
                  >
                    <div style={{ lineHeight: '1.2', whiteSpace: 'nowrap' }}>{day}</div>
                    {dayEvents.length > 0 && (
                      <div style={{ 
                        display: 'flex', 
                        gap: '1px', 
                        marginTop: '1px',
                        flexWrap: 'wrap',
                        justifyContent: 'center',
                        maxWidth: '100%',
                        width: '100%',
                        overflow: 'hidden',
                      }}>
                        {dayEvents.slice(0, 3).map((event) => (
                          <div
                            key={event.event_id}
                            onClick={(e) => handleEventClick(e, event)}
                            style={{
                              width: '3px',
                              height: '3px',
                              borderRadius: '50%',
                              background: event.color || 'var(--accent)',
                              cursor: 'pointer',
                              flexShrink: 0,
                            }}
                            title={event.title}
                          />
                        ))}
                        {dayEvents.length > 3 && (
                          <div style={{
                            fontSize: '7px',
                            color: isToday(day) ? 'white' : 'var(--muted)',
                            lineHeight: '1',
                            flexShrink: 0,
                          }}>
                            +{dayEvents.length - 3}
                          </div>
                        )}
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
                    padding: '8px',
                    borderRadius: '6px',
                    border: '1px solid var(--border)',
                    background: isSelected ? 'var(--surface)' : isTodayDate ? 'var(--accent)' : 'transparent',
                    color: isTodayDate ? 'white' : 'var(--ink)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: '11px', fontWeight: '600', marginBottom: '4px' }}>
                    {dayNamesFull[date.getDay()]}, {date.getDate()}
                  </div>
                  {dateEvents.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
                      {dateEvents.slice(0, 3).map((event) => (
                        <div
                          key={event.event_id}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEventClick(e, event);
                          }}
                          style={{
                            fontSize: '10px',
                            padding: '4px 6px',
                            borderRadius: '4px',
                            background: event.color || 'var(--accent)',
                            color: 'white',
                            cursor: 'pointer',
                          }}
                        >
                          {event.all_day ? event.title : `${event.start_time?.substring(0, 5) || ''} ${event.title}`}
                        </div>
                      ))}
                      {dateEvents.length > 3 && (
                        <div style={{ fontSize: '9px', color: isTodayDate ? 'white' : 'var(--muted)' }}>
                          +{dateEvents.length - 3} more
                        </div>
                      )}
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
                  padding: '20px', 
                  textAlign: 'center', 
                  color: 'var(--muted)', 
                  fontSize: '12px' 
                }}>
                  No events for this day
                </div>
              ) : (
                dateEvents.map((event) => (
                  <div
                    key={event.event_id}
                    onClick={(e) => handleEventClick(e, event)}
                    style={{
                      padding: '10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                      cursor: 'pointer',
                      borderLeft: `4px solid ${event.color || 'var(--accent)'}`,
                    }}
                  >
                    <div style={{ fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: 'var(--ink)' }}>
                      {event.title}
                    </div>
                    {!event.all_day && event.start_time && (
                      <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
                        {event.start_time.substring(0, 5)}
                        {event.end_time && ` - ${event.end_time.substring(0, 5)}`}
                      </div>
                    )}
                    {event.location && (
                      <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                        📍 {event.location}
                      </div>
                    )}
                  </div>
                ))
              )}
              <button
                onClick={() => {
                  setEditingEvent(null);
                  setShowEventModal(true);
                }}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: 'var(--surface)',
                  border: '1px dashed var(--border)',
                  borderRadius: '6px',
                  color: 'var(--ink)',
                  fontSize: '12px',
                  cursor: 'pointer',
                  marginTop: '8px',
                }}
              >
                + Add Event
              </button>
            </div>
          );
        })()}
      </div>

      {/* Connect calendar button */}
      <button
        onClick={handleConnectCalendar}
        style={{
          width: '100%',
          padding: '8px 12px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          color: 'var(--accent)',
          fontSize: '12px',
          fontWeight: '500',
          cursor: 'pointer',
          transition: 'all 0.2s',
          marginTop: '8px',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--panel)';
          e.currentTarget.style.borderColor = 'var(--accent)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--surface)';
          e.currentTarget.style.borderColor = 'var(--border)';
        }}
      >
        Connect External Calendar
      </button>

      {/* Event Modal */}
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
    </div>
  );
}

// Event Modal Component
function EventModal({
  selectedDate,
  event,
  onSave,
  onDelete,
  onClose,
  loading,
}: {
  selectedDate: Date | null;
  event: CalendarEvent | null;
  onSave: (data: { title: string; description?: string; location?: string; all_day?: boolean; start_time?: string; end_time?: string; color?: string }) => void;
  onDelete?: () => void;
  onClose: () => void;
  loading: boolean;
}) {
  const [title, setTitle] = useState(event?.title || '');
  const [description, setDescription] = useState(event?.description || '');
  const [location, setLocation] = useState(event?.location || '');
  const [allDay, setAllDay] = useState(event?.all_day !== false);
  const [startTime, setStartTime] = useState(event?.start_time || '09:00');
  const [endTime, setEndTime] = useState(event?.end_time || '10:00');
  const [color, setColor] = useState(event?.color || '#3b82f6');
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const locationInputRef = useRef<HTMLInputElement>(null);
  const locationDropdownRef = useRef<HTMLDivElement>(null);

  // Get current location on mount
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCurrentLocation({
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          });
        },
        (error) => {
          console.log('Geolocation error:', error);
          // Continue without location - not critical
        },
        {
          enableHighAccuracy: false,
          timeout: 5000,
          maximumAge: 300000, // Cache for 5 minutes
        }
      );
    }
  }, []);

  // Fetch location suggestions - only when user is typing
  useEffect(() => {
    // Don't fetch if input is empty
    if (location.trim().length === 0) {
      setLocationSuggestions([]);
      setShowLocationDropdown(false);
      return;
    }

    const fetchSuggestions = async () => {
      setLocationLoading(true);
      
      try {
        const options: Parameters<typeof getLocationSuggestions>[0] = {
          query: location.trim(), // Always require a query
        };

        // Add current location if available (for distance calculation)
        if (currentLocation) {
          options.currentLat = currentLocation.lat;
          options.currentLon = currentLocation.lon;
        }

        // Only fetch if query is at least 2 characters
        if (location.trim().length >= 2) {
          const response = await getLocationSuggestions(options);
          setLocationSuggestions(response.suggestions);
          
          // Show dropdown if there are suggestions
          if (response.suggestions.length > 0) {
            setShowLocationDropdown(true);
          } else {
            setShowLocationDropdown(false);
          }
        } else {
          setLocationSuggestions([]);
          setShowLocationDropdown(false);
        }
      } catch (err) {
        console.error('Failed to fetch location suggestions:', err);
        setLocationSuggestions([]);
        setShowLocationDropdown(false);
      } finally {
        setLocationLoading(false);
      }
    };

    // Debounce API calls - wait for user to stop typing
    const timeoutId = setTimeout(fetchSuggestions, 300);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [location, currentLocation]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        locationInputRef.current &&
        !locationInputRef.current.contains(event.target as Node) &&
        locationDropdownRef.current &&
        !locationDropdownRef.current.contains(event.target as Node)
      ) {
        setShowLocationDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      alert('Please enter a title for the event');
      return;
    }
    onSave({
      title: title.trim(),
      description: description.trim() || undefined,
      location: location.trim() || undefined,
      all_day: allDay,
      start_time: allDay ? undefined : startTime,
      end_time: allDay ? undefined : endTime,
      color: color,
    });
  };

  const colorOptions = [
    '#3b82f6', // blue
    '#ef4444', // red
    '#10b981', // green
    '#f59e0b', // amber
    '#8b5cf6', // purple
    '#ec4899', // pink
  ];

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--panel)',
          borderRadius: '12px',
          padding: '24px',
          width: '90%',
          maxWidth: '400px',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: 'var(--ink)' }}>
            {event ? 'Edit Event' : 'New Event'}
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: '20px',
              color: 'var(--muted)',
              padding: '4px 8px',
            }}
          >
            ×
          </button>
        </div>

        {selectedDate && (
          <div style={{ marginBottom: '16px', fontSize: '14px', color: 'var(--muted)' }}>
            {selectedDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: '500', color: 'var(--ink)' }}>
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Event title"
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                background: 'var(--surface)',
                color: 'var(--ink)',
                fontSize: '14px',
              }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: '500', color: 'var(--ink)' }}>
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Event description (optional)"
              rows={3}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                background: 'var(--surface)',
                color: 'var(--ink)',
                fontSize: '14px',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
          </div>

          <div style={{ marginBottom: '16px', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: '500', color: 'var(--ink)' }}>
                Location
              </label>
              {currentLocation && (
                <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
                  📍 Using your location
                </span>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <input
                ref={locationInputRef}
                type="text"
                value={location}
                onChange={(e) => {
                  setLocation(e.target.value);
                  setShowLocationDropdown(true);
                }}
              onFocus={() => {
                // Only show dropdown if there are suggestions and user has typed something
                if (location.trim().length >= 2 && locationSuggestions.length > 0) {
                  setShowLocationDropdown(true);
                }
              }}
                placeholder="Type to search locations (e.g., library, office, conference room)"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  paddingRight: locationLoading ? '36px' : '12px',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  fontSize: '14px',
                  transition: 'border-color 0.2s',
                }}
                onBlur={() => {
                  // Delay closing to allow click on dropdown
                  setTimeout(() => {
                    if (!locationDropdownRef.current?.contains(document.activeElement)) {
                      setShowLocationDropdown(false);
                    }
                  }, 200);
                }}
              />
              {locationLoading && (
                <div
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '16px',
                    height: '16px',
                    border: '2px solid var(--muted)',
                    borderTopColor: 'var(--accent)',
                    borderRadius: '50%',
                    animation: 'spin 0.6s linear infinite',
                  }}
                />
              )}
            </div>
            {showLocationDropdown && locationSuggestions.length > 0 && (
              <div
                ref={locationDropdownRef}
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  marginTop: '6px',
                  background: 'var(--panel)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                  maxHeight: '280px',
                  overflowY: 'auto',
                  zIndex: 1001,
                  border: '1px solid var(--border)',
                }}
              >
                {locationSuggestions.map((suggestion, idx) => (
                  <div
                    key={`${suggestion.name}-${idx}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      // Use full address if available, otherwise use name
                      const locationValue = suggestion.full_address || suggestion.name;
                      setLocation(locationValue);
                      setShowLocationDropdown(false);
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault(); // Prevent input blur
                    }}
                    style={{
                      padding: '12px 16px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      color: 'var(--ink)',
                      borderBottom: idx < locationSuggestions.length - 1 ? '1px solid var(--border)' : 'none',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      transition: 'background-color 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--surface)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontWeight: '500' }}>{suggestion.name}</span>
                      {suggestion.full_address && suggestion.full_address !== suggestion.name && (
                        <span style={{
                          fontSize: '11px',
                          color: 'var(--muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {suggestion.full_address}
                        </span>
                      )}
                    </div>
                    {suggestion.distance !== null && suggestion.distance !== undefined && (
                      <span style={{
                        fontSize: '12px',
                        color: 'var(--muted)',
                        marginLeft: '12px',
                        whiteSpace: 'nowrap',
                      }}>
                        {suggestion.distance.toFixed(1)} mi
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {showLocationDropdown && locationSuggestions.length === 0 && !locationLoading && location.trim().length > 0 && (
              <div
                ref={locationDropdownRef}
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  marginTop: '6px',
                  background: 'var(--panel)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '16px',
                  textAlign: 'center',
                  color: 'var(--muted)',
                  fontSize: '13px',
                  zIndex: 1001,
                }}
              >
                No locations found
              </div>
            )}
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: '500', color: 'var(--ink)' }}>
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              All day
            </label>
          </div>

          {!allDay && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: '500', color: 'var(--ink)' }}>
                  Start Time
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    background: 'var(--surface)',
                    color: 'var(--ink)',
                    fontSize: '14px',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: '500', color: 'var(--ink)' }}>
                  End Time
                </label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    background: 'var(--surface)',
                    color: 'var(--ink)',
                    fontSize: '14px',
                  }}
                />
              </div>
            </div>
          )}

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: '500', color: 'var(--ink)' }}>
              Color
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {colorOptions.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '6px',
                    background: c,
                    border: color === c ? '2px solid var(--ink)' : '2px solid transparent',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                disabled={loading}
                style={{
                  padding: '8px 16px',
                  background: 'var(--error)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  opacity: loading ? 0.5 : 1,
                }}
              >
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={{
                padding: '8px 16px',
                background: 'var(--surface)',
                color: 'var(--ink)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                opacity: loading ? 0.5 : 1,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim()}
              style={{
                padding: '8px 16px',
                background: 'var(--accent)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: loading || !title.trim() ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                opacity: loading || !title.trim() ? 0.5 : 1,
              }}
            >
              {loading ? 'Saving...' : event ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Day Events List Component
function DayEventsList({ selectedDate }: { selectedDate: Date | null }) {
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
        const sortedEvents = response.events.sort((a, b) => {
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
      <div style={{
        background: 'var(--panel)',
        borderRadius: '12px',
        padding: '16px',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow)',
        maxHeight: '400px',
        overflowY: 'auto',
      }}>
        <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: 'var(--ink)' }}>
          Day Events
        </h3>
        <div style={{ color: 'var(--muted)', fontSize: '13px', padding: '8px' }}>
          Click on a date to see events
        </div>
      </div>
    );
  }

  const dayName = selectedDate.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = selectedDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div style={{
      background: 'var(--panel)',
      borderRadius: '12px',
      padding: '16px',
      border: '1px solid var(--border)',
      boxShadow: 'var(--shadow)',
      maxHeight: '400px',
      overflowY: 'auto',
    }}>
      <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px', color: 'var(--ink)' }}>
        {dayName}
      </h3>
      <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '12px' }}>
        {dateStr}
      </div>
      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: '13px', padding: '8px' }}>Loading...</div>
      ) : events.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: '13px', padding: '8px' }}>No events for this day</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {events.map((event) => (
            <div
              key={event.event_id}
              style={{
                padding: '10px',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                background: 'var(--background)',
                borderLeft: `4px solid ${event.color || 'var(--accent)'}`,
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--ink)', marginBottom: '4px' }}>
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
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [focusAreas, setFocusAreas] = useState<FocusArea[]>([]);
  const [activeGraphId, setActiveGraphId] = useState<string>('');
  const [_suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [recentSessions, setRecentSessions] = useState<SessionSummary[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [_graphs, setGraphs] = useState<GraphSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [currentSessionId, setCurrentSessionIdState] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load focus areas and active graph
  useEffect(() => {
    async function loadData() {
      try {
        const [areas, graphsData] = await Promise.all([
          getFocusAreas().catch(() => []),
          listGraphs().catch(() => ({ graphs: [], active_graph_id: '' })),
        ]);
        setFocusAreas(areas);
        setActiveGraphId(graphsData.active_graph_id || graphsData.graphs[0]?.graph_id || '');
        setGraphs(graphsData.graphs || []);
        
        // Load sessions
        const sessions = await fetchRecentSessions(10);
        setRecentSessions(sessions);
        
        // Load chat sessions
        const chats = getChatSessions();
        const sortedChats = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
        setChatSessions(sortedChats.slice(0, 5));
        
        // Load current session ID if exists (from localStorage)
        if (typeof window !== 'undefined') {
          const storedSessionId = localStorage.getItem('brainweb:currentChatSession');
          if (storedSessionId) {
            setCurrentSessionIdState(storedSessionId);
          }
        }
        
        setSessionsLoading(false);
        
        // Set initial suggested questions based on focus areas
        const activeAreas = areas.filter(a => a.active);
        if (activeAreas.length > 0) {
          setSuggestedQuestions([
            `What are we working on related to ${activeAreas[0].name}?`,
            `What's my itinerary for today?`,
            `What are the latest updates on things I care about?`,
            `Show me recent activity in my knowledge graph`,
          ]);
        } else {
          setSuggestedQuestions([
            `What are we working on?`,
            `What's my itinerary for today?`,
            `What are the latest updates?`,
            `Show me recent activity`,
          ]);
        }
      } catch (err) {
        console.error('Failed to load data:', err);
        setSessionsLoading(false);
      }
    }
    loadData();
    
    // Refresh chat sessions periodically
    const interval = setInterval(() => {
      const chats = getChatSessions();
      const sortedChats = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
      setChatSessions(sortedChats.slice(0, 5));
    }, 2000);
    
    return () => clearInterval(interval);
  }, []);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      // Small delay to ensure DOM is updated
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [messages, loading]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim() || loading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: query.trim(),
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setQuery('');
    setLoading(true);

    try {
      const response = await fetch('/api/brain-web/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          mode: 'graphrag',
          graph_id: activeGraphId,
          response_prefs: {
            mode: 'compact',
            ask_question_policy: 'at_most_one',
            end_with_next_step: false,
          },
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = await response.json();
      const answer = data.answer || 'I apologize, but I could not generate a response.';

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: answer,
        timestamp: Date.now(),
      };

      setMessages(prev => [...prev, assistantMessage]);
      
      // Save chat session
      try {
        if (!currentSessionId) {
          // Create new session for first message
          const newSession = await createChatSession(
            userMessage.content,
            answer,
            data.answerId || null,
            activeGraphId
          );
          setCurrentSessionIdState(newSession.id);
          setCurrentSessionId(newSession.id);
        } else {
          // Add message to existing session
          addMessageToSession(
            currentSessionId,
            userMessage.content,
            answer,
            data.answerId || null,
            data.suggestedQuestions || [],
            data.evidenceUsed || []
          );
        }
        // Refresh chat sessions list
        const chats = getChatSessions();
        const sortedChats = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
        setChatSessions(sortedChats.slice(0, 5));
      } catch (err) {
        console.error('Failed to save chat session:', err);
      }
      
      // Update suggested questions based on response
      if (data.suggestedQuestions && data.suggestedQuestions.length > 0) {
        setSuggestedQuestions(data.suggestedQuestions.slice(0, 4));
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [query, loading, activeGraphId]);

  const _handleSuggestionClick = (suggestion: string) => {
    setQuery(suggestion);
    inputRef.current?.focus();
  };

  // Navigation helpers for sessions
  const navigateToExplorer = (params?: { conceptId?: string; graphId?: string; chat?: string }) => {
    const queryParams = new URLSearchParams();
    if (params?.conceptId) {
      queryParams.set('select', params.conceptId);
    }
    if (params?.graphId) {
      queryParams.set('graph_id', params.graphId);
    }
    if (params?.chat) {
      queryParams.set('chat', params.chat);
    }
    const queryString = queryParams.toString();
    router.push(`/${queryString ? `?${queryString}` : ''}`);
  };

  const handleLoadChatSession = (chatSession: ChatSession) => {
    // Set the current session ID
    setCurrentSessionIdState(chatSession.id);
    setCurrentSessionId(chatSession.id);
    
    // Set the graph ID if available
    if (chatSession.graphId) {
      setActiveGraphId(chatSession.graphId);
    }
    
    // Convert chat session messages to ChatMessage format and load them
    const loadedMessages: ChatMessage[] = chatSession.messages.flatMap((msg, index) => [
      {
        id: `${msg.id}_user`,
        role: 'user' as const,
        content: msg.question,
        timestamp: msg.timestamp,
      },
      {
        id: `${msg.id}_assistant`,
        role: 'assistant' as const,
        content: msg.answer,
        timestamp: msg.timestamp + 1, // Slightly after user message
      },
    ]);
    
    setMessages(loadedMessages);
    
    // Scroll to bottom after messages load
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
    
    // Focus the input
    inputRef.current?.focus();
  };

  const handleResumeSession = (session: SessionSummary) => {
    navigateToExplorer({
      conceptId: session.last_concept_id,
      graphId: session.graph_id,
    });
  };

  const formatChatSessionTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
  };

  const formatGraphSessionTime = (endAt: string): string => {
    try {
      const date = new Date(endAt);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      
      return date.toLocaleDateString();
    } catch {
      return 'Recent';
    }
  };

  const groupSessionsByDate = (sessions: SessionSummary[]) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const groups: { label: string; sessions: SessionSummary[] }[] = [
      { label: 'Today', sessions: [] },
      { label: 'Yesterday', sessions: [] },
      { label: 'This Week', sessions: [] },
    ];

    sessions.forEach((session) => {
      const sessionDate = new Date(session.end_at);
      const sessionDay = new Date(sessionDate.getFullYear(), sessionDate.getMonth(), sessionDate.getDate());
      
      if (sessionDay.getTime() === today.getTime()) {
        groups[0].sessions.push(session);
      } else if (sessionDay.getTime() === yesterday.getTime()) {
        groups[1].sessions.push(session);
      } else if (sessionDate >= weekAgo) {
        groups[2].sessions.push(session);
      }
    });

    return groups.filter(group => group.sessions.length > 0);
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--page-bg)',
      display: 'flex',
    }}>
      {/* Left Sidebar - Session Drawer */}
      <SessionDrawer 
        isCollapsed={sidebarCollapsed} 
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)} 
      />

      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Main content area with right sidebar */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Conversation area - center */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}>
            {/* Scrollable messages area */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '54px 20px 0px 20px',
              display: 'flex',
              flexDirection: 'column',
            }}>
              <div style={{ maxWidth: '900px', margin: '0 auto', width: '100%', flex: 1, display: 'flex', flexDirection: 'column', paddingBottom: messages.length > 0 ? '20px' : '40px' }}>
                {messages.length === 0 ? (
                <div style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  justifyContent: 'flex-start',
                  paddingTop: '0px',
                  gap: '32px',
                }}>
                  <div style={{
                    maxWidth: '600px',
                    width: '100%',
                    background: 'var(--panel)',
                    borderRadius: '16px',
                    padding: '48px',
                    boxShadow: 'var(--shadow)',
                    border: '1px solid var(--border)',
                  }}>
                    {/* Welcome Section */}
                    <div style={{
                      marginBottom: '24px',
                      textAlign: 'center',
                    }}>
                      <div style={{
                        fontSize: '32px',
                        fontWeight: '600',
                        color: 'var(--ink)',
                        marginBottom: '12px',
                        lineHeight: '1.2',
                      }}>
                        Welcome User
                      </div>
                      <div style={{
                        fontSize: '18px',
                        color: 'var(--muted)',
                        marginBottom: '24px',
                      }}>
                        What would you like to focus on today?
                      </div>
                    </div>
                    
                    {/* Chat Input Bar */}
                    <form onSubmit={handleSubmit} style={{ width: '100%' }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '14px 20px',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: '12px',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
                        minHeight: '56px',
                      }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--muted)', flexShrink: 0 }}>
                          <circle cx="11" cy="11" r="8"></circle>
                          <path d="m21 21-4.35-4.35"></path>
                        </svg>
                        <input
                          ref={inputRef}
                          type="text"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Ask anything... What are we working on? What's my itinerary? Latest updates?"
                          style={{
                            flex: 1,
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--ink)',
                            fontSize: '16px',
                            outline: 'none',
                            fontFamily: 'inherit',
                            padding: '0',
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleSubmit();
                            }
                          }}
                        />
                        {loading && (
                          <div style={{
                            width: '16px',
                            height: '16px',
                            border: '2px solid var(--accent)',
                            borderTopColor: 'transparent',
                            borderRadius: '50%',
                            animation: 'spin 0.6s linear infinite',
                          }} />
                        )}
                      </div>
                    </form>
                    
                    {/* Focus areas indicator - below input */}
                    {focusAreas.filter(a => a.active).length > 0 && (
                      <div style={{
                        marginTop: '12px',
                        fontSize: '11px',
                        color: 'var(--muted)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        flexWrap: 'wrap',
                        justifyContent: 'center',
                      }}>
                        <span>Focusing on:</span>
                        {focusAreas.filter(a => a.active).map(area => (
                          <span
                            key={area.id}
                            style={{
                              padding: '2px 8px',
                              background: 'transparent',
                              borderRadius: '8px',
                              color: 'var(--muted)',
                            }}
                          >
                            {area.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Sessions List */}
                  {!sessionsLoading && (() => {
                    const sessionGroups = groupSessionsByDate(recentSessions);
                    return chatSessions.length > 0 || sessionGroups.length > 0;
                  })() && (
                    <div style={{
                      maxWidth: '600px',
                      width: '100%',
                    }}>
                      {(() => {
                        const sessionGroups = groupSessionsByDate(recentSessions);
                        return (
                          <>
                            {/* Chat Sessions */}
                            {chatSessions.length > 0 && (
                              <div style={{ marginBottom: '24px' }}>
                                <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                  Chat Sessions
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                  {chatSessions.map((chatSession) => (
                                    <div
                                      key={chatSession.id}
                                      onClick={() => handleLoadChatSession(chatSession)}
                                      style={{
                                        padding: '10px',
                                        borderRadius: '8px',
                                        border: '1px solid var(--border)',
                                        cursor: 'pointer',
                                        transition: 'background 0.2s',
                                        background: 'var(--background)',
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.background = 'var(--surface)';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.background = 'var(--background)';
                                      }}
                                    >
                                      <div style={{ fontSize: '13px', fontWeight: '500', color: 'var(--ink)', marginBottom: '4px' }}>
                                        {chatSession.title}
                                      </div>
                                      <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
                                        {formatChatSessionTime(chatSession.updatedAt)} • {chatSession.messages.length} message{chatSession.messages.length !== 1 ? 's' : ''}
                                      </div>
                                      {chatSession.messages.length > 0 && (
                                        <div style={{ fontSize: '12px', color: 'var(--muted)', fontStyle: 'italic' }}>
                                          &quot;{chatSession.messages[0].question.substring(0, 60)}{chatSession.messages[0].question.length > 60 ? '...' : ''}&quot;
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Graph Sessions */}
                            {sessionGroups.length > 0 && (
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Graph Sessions
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {sessionGroups.map((group) => (
                              <div key={group.label}>
                                <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                  {group.label}
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                  {group.sessions.map((session) => (
                                    <div
                                      key={session.session_id}
                                      onClick={() => handleResumeSession(session)}
                                      style={{
                                        padding: '10px',
                                        borderRadius: '8px',
                                        border: '1px solid var(--border)',
                                        cursor: 'pointer',
                                        transition: 'background 0.2s',
                                        background: 'var(--background)',
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.background = 'var(--surface)';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.background = 'var(--background)';
                                      }}
                                    >
                                      <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
                                        {formatGraphSessionTime(session.end_at)}
                                        {session.top_concepts.length > 0 && (
                                          <> • {session.top_concepts.length} concept{session.top_concepts.length !== 1 ? 's' : ''}</>
                                        )}
                                      </div>
                                      <div style={{ fontSize: '12px', color: 'var(--ink)', marginBottom: '6px' }}>
                                        {session.summary || 'Session'}
                                      </div>
                                      {session.top_concepts.length > 0 && (
                                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' }}>
                                          {session.top_concepts.slice(0, 2).map((concept) => (
                                            <span
                                              key={concept.concept_id}
                                              style={{
                                                fontSize: '10px',
                                                padding: '2px 6px',
                                                background: 'var(--surface)',
                                                borderRadius: '4px',
                                                color: 'var(--ink)',
                                                border: '1px solid var(--border)',
                                              }}
                                            >
                                              {concept.concept_name || concept.concept_id}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', flex: 1 }}>
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <div style={{
                        maxWidth: '80%',
                        padding: '16px 20px',
                        borderRadius: '16px',
                        background: msg.role === 'user' 
                          ? 'var(--accent)' 
                          : 'var(--panel)',
                        color: msg.role === 'user' ? 'white' : 'var(--ink)',
                        border: msg.role === 'assistant' ? '1px solid var(--border)' : 'none',
                        fontSize: '15px',
                        lineHeight: '1.6',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}>
                        {msg.content}
                      </div>
                      <div style={{
                        fontSize: '11px',
                        color: 'var(--muted)',
                        padding: '0 4px',
                      }}>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div style={{
                      padding: '16px 20px',
                      borderRadius: '16px',
                      background: 'var(--panel)',
                      border: '1px solid var(--border)',
                      color: 'var(--muted)',
                      fontSize: '15px',
                    }}>
                      Thinking...
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                  
                  {/* Chat Input Bar - positioned right after messages */}
                  {messages.length > 0 && (
                    <div style={{
                      marginTop: '24px',
                      paddingTop: '20px',
                      borderTop: '1px solid var(--border)',
                      display: 'flex',
                      justifyContent: 'center',
                    }}>
                      <div style={{ maxWidth: '900px', width: '100%' }}>
                        <form onSubmit={handleSubmit} style={{ width: '100%' }}>
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            padding: '20px 28px',
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            borderRadius: '12px',
                            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
                            minHeight: '64px',
                          }}>
                            <input
                              ref={inputRef}
                              type="text"
                              value={query}
                              onChange={(e) => setQuery(e.target.value)}
                              placeholder="Continue the conversation..."
                              style={{
                                flex: 1,
                                border: 'none',
                                background: 'transparent',
                                color: 'var(--ink)',
                                fontSize: '16px',
                                outline: 'none',
                                fontFamily: 'inherit',
                                padding: '0',
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  handleSubmit();
                                }
                              }}
                            />
                            {loading && (
                              <div style={{
                                width: '16px',
                                height: '16px',
                                border: '2px solid var(--accent)',
                                borderTopColor: 'transparent',
                                borderRadius: '50%',
                                animation: 'spin 0.6s linear infinite',
                              }} />
                            )}
                          </div>
                        </form>
                      </div>
                    </div>
                  )}
                </div>
              )}
              </div>
            </div>
          </div>

          {/* Right Sidebar */}
          <div style={{
            width: '280px',
            borderLeft: '1px solid var(--border)',
            background: 'var(--panel)',
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            padding: '20px',
            gap: '20px',
            flexShrink: 0,
          }}>
            {/* Calendar Widget - Top */}
            <CalendarWidget selectedDate={selectedDate} onDateSelect={setSelectedDate} />

            {/* Day Events - Bottom */}
            <DayEventsList selectedDate={selectedDate} />
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
