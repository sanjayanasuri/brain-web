'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getFocusAreas, listGraphs, type FocusArea, type GraphSummary, listCalendarEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, getLocationSuggestions, type CalendarEvent, type LocationSuggestion } from '../api-client';
import SessionDrawer from '../components/navigation/SessionDrawer';
import { fetchRecentSessions, type SessionSummary } from '../lib/eventsClient';
import { getChatSessions, setCurrentSessionId, createChatSession, addMessageToSession, type ChatSession } from '../lib/chatSessions';
import { BranchProvider, useBranchContext } from '../components/chat/BranchContext';
import ChatMessageWithBranches from '../components/chat/ChatMessageWithBranches';
import { emitChatMessageCreated } from '../lib/sessionEvents';
import { consumeLectureLinkReturn } from '../lib/lectureLinkNavigation';
import { createBranch } from '../lib/branchUtils';
import { getAuthHeaders } from '../lib/authToken';
import ContextPanel from '../components/context/ContextPanel';

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

function ChatMessagesList({
  messages,
  chatSessionId,
  loading,
}: {
  messages: ChatMessage[];
  chatSessionId: string | null;
  loading: boolean;
}) {
  const branchContext = useBranchContext();

  const handleExplain = useCallback(async (
    messageId: string,
    startOffset: number,
    endOffset: number,
    selectedText: string,
    parentContent: string
  ) => {
    try {
      const branchResponse = await createBranch({
        parent_message_id: messageId,
        parent_message_content: parentContent,
        start_offset: startOffset,
        end_offset: endOffset,
        selected_text: selectedText,
        chat_id: chatSessionId || localStorage.getItem('brainweb:currentChatSession'),
      });

      branchContext.openBranch(
        branchResponse.branch.id,
        messageId,
        startOffset,
        endOffset
      );
      // Note: openBranch already sets the highlight span via BranchContext
    } catch (err) {
      console.error('[handleExplain] Failed to create branch:', err);
      console.error('[handleExplain] Error details:', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        messageId,
        startOffset,
        endOffset,
      });
      alert(`Failed to create branch: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [branchContext, chatSessionId]);

  const handleOpenBranch = useCallback((branchId: string, messageId: string) => {
    // Get branch to find span offsets
    branchContext.openBranch(branchId, messageId, 0, 0);
  }, [branchContext]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)', flex: 1 }}>
      {messages.map((msg) => (
        <div
          key={msg.id}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--spacing-sm)',
            alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
          }}
        >
          {msg.role === 'assistant' ? (
            <ChatMessageWithBranches
              messageId={msg.id}
              content={msg.content}
              role={msg.role}
              timestamp={msg.timestamp}
              onExplain={handleExplain}
              onOpenBranch={handleOpenBranch}
              highlightStart={branchContext.getHighlightSpan(msg.id)?.start}
              highlightEnd={branchContext.getHighlightSpan(msg.id)?.end}
            />
          ) : (
            <>
              <div style={{
                maxWidth: 'min(80%, 600px)',
                padding: 'var(--spacing-md) var(--spacing-md)',
                borderRadius: '16px',
                background: 'var(--accent)',
                color: 'white',
                fontSize: 'clamp(15px, 2.1vw, 17px)',
                lineHeight: '1.6',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {msg.content}
              </div>
              <div style={{
                fontSize: 'clamp(11px, 1.6vw, 12px)',
                color: 'var(--muted)',
                padding: '0 var(--spacing-xs)',
              }}>
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
              </div>
            </>
          )}
        </div>
      ))}
      {loading && (
        <div style={{
          padding: '16px 20px',
          borderRadius: '16px',
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          color: 'var(--muted)',
          fontSize: 'clamp(15px, 2.1vw, 17px)',
        }}>
          Thinking...
        </div>
      )}
    </div>
  );
}

function HomePageInner() {
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
  const [isMobile, setIsMobile] = useState(false);
  const [notesModalSessionId, setNotesModalSessionId] = useState<string | null>(null);
  const [notesDigest, setNotesDigest] = useState<any>(null);
  const [notesLoading, setNotesLoading] = useState(false);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [showContextPanel, setShowContextPanel] = useState(false);
  const [domainConcepts, setDomainConcepts] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const previousSessionIdRef = useRef<string | null>(null);

  // Handle responsive design
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

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

  // Auto-trigger notes when component unmounts or session changes
  useEffect(() => {
    return () => {
      // On unmount, trigger notes for current session if it has messages
      if (currentSessionId) {
        const session = getChatSessions().find(s => s.id === currentSessionId);
        if (session && session.messages.length > 0) {
          triggerNotesForSession(currentSessionId);
        }
      }
    };
  }, [currentSessionId]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const currentPath = `${window.location.pathname}${window.location.search}`;
      const returnState = consumeLectureLinkReturn(currentPath);
      if (returnState?.windowScrollTop !== undefined) {
        window.scrollTo({ top: returnState.windowScrollTop, behavior: 'auto' });
        return;
      }
    }
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
        let sessionIdForEvent = currentSessionId;
        if (!currentSessionId) {
          // Auto-trigger notes for previous session if it exists
          if (previousSessionIdRef.current) {
            const previousSession = getChatSessions().find(s => s.id === previousSessionIdRef.current);
            if (previousSession && previousSession.messages.length > 0) {
              triggerNotesForSession(previousSessionIdRef.current);
            }
          }
          
          // Create new session for first message
          const newSession = await createChatSession(
            userMessage.content,
            answer,
            data.answerId || null,
            null,
            activeGraphId
          );
          sessionIdForEvent = newSession.id;
          previousSessionIdRef.current = newSession.id;
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
        if (sessionIdForEvent) {
          emitChatMessageCreated(sessionIdForEvent, {
            message: userMessage.content,
            answer,
            answer_summary: answer.slice(0, 500),
            message_id: assistantMessage.id,
          }).catch((err) => {
            console.warn('Failed to emit chat message event:', err);
          });
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

  // Auto-trigger notes when switching away from a session
  const triggerNotesForSession = async (sessionId: string) => {
    if (!sessionId || sessionId === previousSessionIdRef.current) return;
    
    try {
      const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
      const authHeaders = await getAuthHeaders();
      await fetch(`${API_BASE_URL}/chats/${sessionId}/notes/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ trigger_source: 'session_closed' }),
      });
    } catch (err) {
      console.warn('Failed to auto-trigger notes for session:', err);
    }
  };

  const handleLoadChatSession = (chatSession: ChatSession) => {
    // Auto-trigger notes for the previous session if it exists and has messages
    const previousSessionId = previousSessionIdRef.current;
    if (previousSessionId && previousSessionId !== chatSession.id) {
      const previousSession = getChatSessions().find(s => s.id === previousSessionId);
      if (previousSession && previousSession.messages.length > 0) {
        triggerNotesForSession(previousSessionId);
      }
    }
    
    // Update previous session ref
    previousSessionIdRef.current = chatSession.id;
    
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

  const handleOpenNotesModal = async (sessionId: string) => {
    setNotesModalSessionId(sessionId);
    setNotesLoading(true);
    setNotesDigest(null);
    
    try {
      const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
      const authHeaders = await getAuthHeaders();
      
      // Fetch both notes and chat session messages
      const [notesResponse, chatSession] = await Promise.all([
        fetch(`${API_BASE_URL}/chats/${sessionId}/notes`, {
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
          },
        }),
        Promise.resolve(getChatSessions().find(s => s.id === sessionId)),
      ]);
      
      if (notesResponse.ok) {
        const data = await notesResponse.json();
        // Enhance notes with chat session data
        if (chatSession) {
          data.chatSession = chatSession;
        }
        setNotesDigest(data);
      } else {
        console.warn('Failed to load notes, they may not exist yet');
      }
    } catch (err) {
      console.error('Failed to load notes:', err);
    } finally {
      setNotesLoading(false);
    }
  };

  // Deduplicate similar entries
  const deduplicateEntries = (entries: any[]): any[] => {
    const seen = new Set<string>();
    const result: any[] = [];
    
    for (const entry of entries) {
      // Create a normalized key from the summary text
      const normalized = entry.summary_text
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .slice(0, 10)
        .join(' ');
      
      if (!seen.has(normalized)) {
        seen.add(normalized);
        result.push(entry);
      }
    }
    
    return result;
  };

  // Extract domain-specific concepts using LLM
  const findDomainConcepts = async (entries: any[]): Promise<Set<string>> => {
    if (entries.length === 0) return new Set();
    
    try {
      const textsToAnalyze = entries.slice(0, 5).map(entry => entry.summary_text); // Limit to first 5 for performance
      const combinedText = textsToAnalyze.join('\n\n');
      
      const response = await fetch('/api/brain-web/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Extract the most important domain-specific concepts and technical terms from this text. Focus on:
- Technical terms, algorithms, methods, processes
- Domain-specific vocabulary (not common words like "it involves", "based on", "in")
- Concepts that would exist as nodes in a knowledge graph
- Terms that are clickable and would lead someone to explore more

Text to analyze:
${combinedText}

Return only a comma-separated list of the most important concepts (maximum 8), no explanations:`,
          sessionId: 'concept-extraction',
          graphId: currentGraphId || 'default',
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        const conceptsText = data.answer || '';
        const concepts = conceptsText
          .split(',')
          .map((c: string) => c.trim())
          .filter((c: string) => c && c.length > 2 && c.length < 30)
          .slice(0, 8); // Limit to 8 concepts
        
        return new Set(concepts);
      }
    } catch (error) {
      console.error('Failed to extract concepts with LLM:', error);
    }
    
    // Fallback: return empty set if LLM fails
    return new Set();
  };

  // Highlight shared phrases in text
  const highlightSharedPhrases = (text: string, sharedPhrases: Set<string>): React.ReactNode => {
    if (sharedPhrases.size === 0) return text;
    
    // Simple approach: highlight phrases that appear in the text
    let highlightedText = text;
    const sortedPhrases = Array.from(sharedPhrases).sort((a, b) => b.length - a.length);
    
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    const matches: Array<{ start: number; end: number; phrase: string }> = [];
    
    // Find all matches
    sortedPhrases.forEach(phrase => {
      const regex = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      let match;
      while ((match = regex.exec(text)) !== null) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          phrase: match[0],
        });
      }
    });
    
    // Sort matches by start position
    matches.sort((a, b) => a.start - b.start);
    
    // Remove overlapping matches (keep longer ones)
    const nonOverlapping: typeof matches = [];
    for (const match of matches) {
      const overlaps = nonOverlapping.some(m => 
        (match.start >= m.start && match.start < m.end) ||
        (match.end > m.start && match.end <= m.end) ||
        (match.start <= m.start && match.end >= m.end)
      );
      if (!overlaps) {
        nonOverlapping.push(match);
      }
    }
    
    // Build highlighted text
    nonOverlapping.forEach((match, idx) => {
      // Add text before match
      if (match.start > lastIndex) {
        parts.push(text.substring(lastIndex, match.start));
      }
      // Add highlighted match
      parts.push(
        <span
          key={`highlight-${idx}`}
          style={{
            background: 'var(--accent)',
            color: 'white',
            padding: '2px 4px',
            borderRadius: '3px',
            fontWeight: '500',
          }}
        >
          {match.phrase}
        </span>
      );
      lastIndex = match.end;
    });
    
    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }
    
    return parts.length > 0 ? <>{parts}</> : text;
  };

  // Find the actual question for an entry from the chat session
  const findQuestionForEntry = (entry: any, chatSession: ChatSession | undefined): string | null => {
    if (!chatSession || !entry.source_message_ids || entry.source_message_ids.length === 0) {
      return null;
    }
    
    // Find user messages that correspond to this entry
    for (const msg of chatSession.messages) {
      if (msg.role === 'user' && msg.eventId && entry.source_message_ids.includes(msg.eventId)) {
        return msg.content;
      }
    }
    
    // Alternative: look for assistant messages with matching event IDs and find preceding user question
    for (const msg of chatSession.messages) {
      if (msg.role === 'assistant' && msg.eventId && entry.source_message_ids.includes(msg.eventId)) {
        // Find the preceding user question
        const msgIndex = chatSession.messages.indexOf(msg);
        for (let i = msgIndex - 1; i >= 0; i--) {
          if (chatSession.messages[i].role === 'user') {
            return chatSession.messages[i].content;
          }
        }
      }
    }
    
    return null;
  };

  const handleCloseNotesModal = () => {
    setNotesModalSessionId(null);
    setNotesDigest(null);
  };

  const handleConceptClick = async (concept: string) => {
    try {
      // Search for this concept in the current graph
      const response = await fetch('/api/brain-web/search-nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: concept,
          graphId: activeGraphId || 'default',
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.nodes && data.nodes.length > 0) {
          // Find the best match for the concept
          const bestMatch = data.nodes.find((node: any) => 
            node.name.toLowerCase() === concept.toLowerCase()
          ) || data.nodes[0];
          
          setSelectedNode(bestMatch);
          setShowContextPanel(true);
        } else {
          // If no exact match, create a search query for the concept
          setQuery(`Tell me about ${concept}`);
        }
      }
    } catch (error) {
      console.error('Failed to search for concept:', error);
      // Fallback: set the concept as a search query
      setQuery(`Tell me about ${concept}`);
    }
  };

  const handleCloseContextPanel = () => {
    setSelectedNode(null);
    setShowContextPanel(false);
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
      height: '100vh',
      background: 'var(--page-bg)',
      display: 'flex',
      overflow: 'hidden',
    }}>
      {/* Left Sidebar - Session Drawer */}
      <SessionDrawer 
        isCollapsed={sidebarCollapsed} 
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)} 
      />

      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
        {/* Main content area with right sidebar */}
        <div style={{ 
          flex: 1, 
          display: 'flex', 
          overflow: 'hidden',
          flexDirection: isMobile ? 'column' : 'row',
        }}>
          {/* Conversation area - center */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minWidth: 0, // Allow flex item to shrink below content size
          }}>
            {/* Scrollable messages area */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '54px clamp(16px, 4vw, 24px) 0 clamp(16px, 4vw, 24px)',
              display: 'flex',
              flexDirection: 'column',
            }}>
              <div style={{ 
                maxWidth: '900px', 
                margin: '0 auto', 
                width: '100%', 
                flex: 1, 
                display: 'flex', 
                flexDirection: 'column', 
                paddingBottom: messages.length > 0 ? 'var(--spacing-md)' : 'var(--spacing-xl)',
                gap: 'var(--spacing-lg)',
              }}>
                {messages.length === 0 ? (
                <div style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  paddingTop: 'clamp(20px, 5vh, 60px)',
                  gap: 'var(--spacing-xl)',
                  width: '100%',
                }}>
                  <div style={{
                    maxWidth: '700px',
                    width: '100%',
                    background: 'var(--panel)',
                    borderRadius: '16px',
                    padding: 'clamp(32px, 6vw, 56px)',
                    boxShadow: 'var(--shadow)',
                    border: '1px solid var(--border)',
                  }}>
                    {/* Welcome Section */}
                    <div style={{
                      marginBottom: 'var(--spacing-lg)',
                      textAlign: 'center',
                    }}>
                      <div style={{
                        fontSize: 'clamp(32px, 5vw, 48px)',
                        fontWeight: '600',
                        color: 'var(--ink)',
                        marginBottom: 'var(--spacing-md)',
                        lineHeight: '1.2',
                      }}>
                        Welcome User
                      </div>
                      <div style={{
                        fontSize: 'clamp(18px, 3vw, 22px)',
                        color: 'var(--muted)',
                        marginBottom: 'var(--spacing-lg)',
                      }}>
                        What would you like to focus on today?
                      </div>
                    </div>
                    
                    {/* Chat Input Bar */}
                    <form onSubmit={handleSubmit} style={{ width: '100%' }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--spacing-sm)',
                        padding: 'var(--spacing-sm) var(--spacing-md)',
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
                            fontSize: 'clamp(16px, 2.2vw, 18px)',
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
                        marginTop: 'var(--spacing-sm)',
                        fontSize: 'clamp(12px, 1.7vw, 13px)',
                        color: 'var(--muted)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--spacing-xs)',
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
                  {!sessionsLoading && (
                    <div style={{
                      maxWidth: '700px',
                      width: '100%',
                    }}>
                      {(() => {
                        const sessionGroups = groupSessionsByDate(recentSessions);
                        const hasSessions = chatSessions.length > 0 || sessionGroups.length > 0;
                        
                        return (
                          <>
                            {/* Chat Sessions */}
                            {chatSessions.length > 0 && (
                              <div style={{ marginBottom: 'var(--spacing-lg)' }}>
                                <div style={{ fontSize: 'clamp(13px, 2vw, 15px)', fontWeight: '600', color: 'var(--muted)', marginBottom: 'var(--spacing-sm)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                  Chat Sessions
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
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
                                        position: 'relative',
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.background = 'var(--surface)';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.background = 'var(--background)';
                                      }}
                                    >
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                                        <div style={{ flex: 1 }}>
                                          <div style={{ fontSize: 'clamp(14px, 2vw, 16px)', fontWeight: '500', color: 'var(--ink)', marginBottom: '6px' }}>
                                            {chatSession.title}
                                          </div>
                                          <div style={{ fontSize: 'clamp(12px, 1.8vw, 13px)', color: 'var(--muted)', marginBottom: '6px' }}>
                                            {formatChatSessionTime(chatSession.updatedAt)} • {chatSession.messages.length} message{chatSession.messages.length !== 1 ? 's' : ''}
                                          </div>
                                          {chatSession.messages.length > 0 && (
                                            <div style={{ fontSize: 'clamp(13px, 1.9vw, 14px)', color: 'var(--muted)', fontStyle: 'italic' }}>
                                              &quot;{chatSession.messages[0].question.substring(0, 60)}{chatSession.messages[0].question.length > 60 ? '...' : ''}&quot;
                                            </div>
                                          )}
                                        </div>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleOpenNotesModal(chatSession.id);
                                          }}
                                          style={{
                                            padding: '6px 10px',
                                            background: 'var(--accent)',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '6px',
                                            fontSize: '11px',
                                            fontWeight: '600',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            flexShrink: 0,
                                          }}
                                          title="View notes"
                                        >
                                          📝 Notes
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Graph Sessions */}
                            {sessionGroups.length > 0 && (
                        <div>
                          <div style={{ fontSize: 'clamp(13px, 2vw, 15px)', fontWeight: '600', color: 'var(--muted)', marginBottom: 'var(--spacing-sm)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Graph Sessions
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                            {sessionGroups.map((group) => (
                              <div key={group.label}>
                                <div style={{ fontSize: 'clamp(12px, 1.7vw, 13px)', fontWeight: '600', color: 'var(--muted)', marginBottom: 'var(--spacing-sm)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                  {group.label}
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
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
                                      <div style={{ fontSize: 'clamp(12px, 1.7vw, 13px)', color: 'var(--muted)', marginBottom: '6px' }}>
                                        {formatGraphSessionTime(session.end_at)}
                                        {session.top_concepts.length > 0 && (
                                          <> • {session.top_concepts.length} concept{session.top_concepts.length !== 1 ? 's' : ''}</>
                                        )}
                                      </div>
                                      <div style={{ fontSize: 'clamp(13px, 1.9vw, 14px)', color: 'var(--ink)', marginBottom: '6px' }}>
                                        {session.summary || 'Session'}
                                      </div>
                                      {session.top_concepts.length > 0 && (
                                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' }}>
                                          {session.top_concepts.slice(0, 2).map((concept) => (
                                            <span
                                              key={concept.concept_id}
                                              style={{
                                              fontSize: 'clamp(11px, 1.6vw, 12px)',
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
                  {sessionsLoading && (
                    <div style={{
                      maxWidth: '600px',
                      width: '100%',
                      padding: 'var(--spacing-md)',
                      textAlign: 'center',
                      color: 'var(--muted)',
                      fontSize: 'clamp(14px, 2vw, 16px)',
                    }}>
                      Loading sessions...
                    </div>
                  )}
                  {!sessionsLoading && chatSessions.length === 0 && (() => {
                    const sessionGroups = groupSessionsByDate(recentSessions);
                    return sessionGroups.length === 0;
                  })() && (
                    <div style={{
                      maxWidth: '700px',
                      width: '100%',
                      padding: 'var(--spacing-md)',
                      textAlign: 'center',
                      color: 'var(--muted)',
                      fontSize: 'clamp(14px, 2vw, 16px)',
                      fontStyle: 'italic',
                    }}>
                      No previous chats or sessions yet. Start a conversation to see it here!
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <ChatMessagesList messages={messages} chatSessionId={currentSessionId} loading={loading} />
                  {loading && (
                    <div style={{
                      padding: '16px 20px',
                      borderRadius: '16px',
                      background: 'var(--panel)',
                      border: '1px solid var(--border)',
                      color: 'var(--muted)',
                      fontSize: 'clamp(15px, 2.1vw, 17px)',
                    }}>
                      Thinking...
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                  
                  {/* Chat Input Bar - positioned right after messages */}
                  {messages.length > 0 && (
                    <div style={{
                      marginTop: 'var(--spacing-lg)',
                      paddingTop: 'var(--spacing-md)',
                      borderTop: '1px solid var(--border)',
                      display: 'flex',
                      justifyContent: 'center',
                    }}>
                      <div style={{ maxWidth: '900px', width: '100%' }}>
                        <form onSubmit={handleSubmit} style={{ width: '100%' }}>
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--spacing-sm)',
                            padding: 'var(--spacing-md) clamp(16px, 3vw, 28px)',
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
                                fontSize: 'clamp(16px, 2.2vw, 18px)',
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
                </>
              )}
              </div>
            </div>
          </div>

          {/* Right Sidebar */}
          <div style={{
            width: isMobile ? '100%' : '280px',
            borderLeft: !isMobile ? '1px solid var(--border)' : 'none',
            borderTop: isMobile ? '1px solid var(--border)' : 'none',
            background: 'var(--panel)',
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            padding: 'var(--spacing-md)',
            gap: 'var(--spacing-md)',
            flexShrink: 0,
            maxHeight: isMobile ? '400px' : 'none',
          }}>
            {/* Calendar Widget - Top */}
            <CalendarWidget selectedDate={selectedDate} onDateSelect={setSelectedDate} />

            {/* Day Events - Bottom */}
            <DayEventsList selectedDate={selectedDate} />
          </div>
        </div>
      </div>

      {/* Notes Modal */}
      {notesModalSessionId && (
        <div
          onClick={handleCloseNotesModal}
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
            padding: '20px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--background)',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '600px',
              width: '100%',
              maxHeight: '80vh',
              overflowY: 'auto',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: '600', color: 'var(--ink)', margin: 0 }}>
                Session Notes
              </h2>
              <button
                onClick={handleCloseNotesModal}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '24px',
                  cursor: 'pointer',
                  color: 'var(--muted)',
                  padding: '0',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ×
              </button>
            </div>

            {notesLoading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
                Loading notes...
              </div>
            ) : !notesDigest || !notesDigest.sections || notesDigest.sections.length === 0 || notesDigest.sections.every((s: any) => !s.entries || s.entries.length === 0) ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
                <p>No notes available yet.</p>
                <p style={{ fontSize: '13px', marginTop: '8px' }}>
                  Notes are automatically created when you switch sessions or close a chat.
                </p>
              </div>
            ) : (() => {
              // Collect all entries and find shared phrases
              const allEntries: any[] = [];
              notesDigest.sections.forEach((section: any) => {
                if (section.entries && section.entries.length > 0) {
                  allEntries.push(...section.entries);
                }
              });
              
              // Deduplicate entries
              const uniqueEntries = deduplicateEntries(allEntries);
              
              // Extract domain concepts using LLM (async operation)
              React.useEffect(() => {
                findDomainConcepts(uniqueEntries).then(concepts => {
                  setDomainConcepts(concepts);
                });
              }, [uniqueEntries.length]); // Re-run when entries change
              
              // Group entries back by section
              const sectionsWithDedupedEntries = notesDigest.sections.map((section: any) => {
                if (!section.entries || section.entries.length === 0) return null;
                const sectionEntries = section.entries.filter((entry: any) => 
                  uniqueEntries.some(ue => ue.id === entry.id)
                );
                if (sectionEntries.length === 0) return null;
                return { ...section, entries: sectionEntries };
              }).filter(Boolean);
              
              const chatSession = notesDigest.chatSession;
              
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {domainConcepts.size > 0 && (
                    <div style={{
                      padding: '12px',
                      background: 'var(--accent)',
                      color: 'white',
                      borderRadius: '6px',
                      fontSize: '12px',
                    }}>
                      <strong>Connected concepts:</strong>{' '}
                      {Array.from(domainConcepts).slice(0, 5).map((concept, idx) => (
                        <React.Fragment key={concept}>
                          {idx > 0 && ', '}
                          <span
                            onClick={() => handleConceptClick(concept)}
                            style={{
                              cursor: 'pointer',
                              textDecoration: 'underline',
                              fontWeight: '600',
                              padding: '2px 4px',
                              borderRadius: '3px',
                              transition: 'background 0.2s',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(255,255,255,0.2)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'transparent';
                            }}
                          >
                            {concept}
                          </span>
                        </React.Fragment>
                      ))}
                      {domainConcepts.size > 5 && ` +${domainConcepts.size - 5} more`}
                    </div>
                  )}
                  
                  {sectionsWithDedupedEntries.map((section: any) => (
                    <div
                      key={section.id}
                      style={{
                        padding: '16px',
                        background: 'var(--panel)',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <div style={{ fontSize: '16px', fontWeight: '600', color: 'var(--ink)', marginBottom: '12px' }}>
                        {section.title}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {section.entries.map((entry: any) => {
                          const question = findQuestionForEntry(entry, chatSession);
                          return (
                            <div
                              key={entry.id}
                              style={{
                                fontSize: '14px',
                                color: 'var(--ink)',
                                lineHeight: '1.6',
                                padding: '12px',
                                background: 'var(--background)',
                                borderRadius: '6px',
                                border: '1px solid var(--border)',
                              }}
                            >
                              {question && (
                                <div style={{
                                  marginBottom: '8px',
                                  paddingBottom: '8px',
                                  borderBottom: '1px solid var(--border)',
                                }}>
                                  <div style={{
                                    fontSize: '12px',
                                    color: 'var(--muted)',
                                    fontWeight: '500',
                                    marginBottom: '4px',
                                  }}>
                                    Question:
                                  </div>
                                  <div style={{
                                    fontSize: '13px',
                                    color: 'var(--ink)',
                                    fontStyle: 'italic',
                                  }}>
                                    "{question}"
                                  </div>
                                </div>
                              )}
                              <div style={{
                                fontSize: '12px',
                                color: 'var(--muted)',
                                fontWeight: '500',
                                marginBottom: '6px',
                              }}>
                                Explanation:
                              </div>
                              <div style={{ lineHeight: '1.7' }}>
                                {highlightSharedPhrases(entry.summary_text, domainConcepts)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Context Panel Overlay */}
      {showContextPanel && selectedNode && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'flex-end',
          zIndex: 1000,
        }}>
          <div style={{
            width: '400px',
            height: '100%',
            background: 'var(--background)',
            borderLeft: '1px solid var(--border)',
            boxShadow: '-2px 0 8px rgba(0, 0, 0, 0.1)',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Header with close button and chat button */}
            <div style={{
              padding: '16px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'var(--panel)',
            }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>
                {selectedNode.name}
              </h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => {
                    setQuery(`Tell me more about ${selectedNode.name}`);
                    handleCloseContextPanel();
                  }}
                  style={{
                    padding: '6px 12px',
                    background: 'var(--accent)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: '500',
                  }}
                >
                  Chat
                </button>
                <button
                  onClick={handleCloseContextPanel}
                  style={{
                    padding: '6px 8px',
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  ×
                </button>
              </div>
            </div>
            
            {/* Context Panel Content */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              <ContextPanel
                selectedNode={selectedNode}
                selectedResources={[]}
                isResourceLoading={false}
                resourceError={null}
                expandedResources={new Set()}
                setExpandedResources={() => {}}
                evidenceFilter="all"
                setEvidenceFilter={() => {}}
                evidenceSearch=""
                setEvidenceSearch={() => {}}
                activeTab="overview"
                setActiveTab={() => {}}
                onClose={handleCloseContextPanel}
              />
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default function HomePage() {
  return (
    <BranchProvider>
      <HomePageInner />
    </BranchProvider>
  );
}
