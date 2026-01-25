import React, { useState, useEffect, useRef } from 'react';
import { getLocationSuggestions, type CalendarEvent, type LocationSuggestion } from '@/app/api-client';
import Button from '../ui/Button';
import { Input } from '../ui/Input';
import Textarea from '../ui/Textarea';
import GlassCard from '../ui/GlassCard';

interface EventModalProps {
    selectedDate: Date | null;
    event: CalendarEvent | null;
    onSave: (data: { title: string; description?: string; location?: string; all_day?: boolean; start_time?: string; end_time?: string; color?: string }) => void;
    onDelete?: () => void;
    onClose: () => void;
    loading: boolean;
}

export default function EventModal({
    selectedDate,
    event,
    onSave,
    onDelete,
    onClose,
    loading,
}: EventModalProps) {
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
        if (location.trim().length === 0) {
            setLocationSuggestions([]);
            setShowLocationDropdown(false);
            return;
        }

        const fetchSuggestions = async () => {
            setLocationLoading(true);

            try {
                const options: Parameters<typeof getLocationSuggestions>[0] = {
                    query: location.trim(),
                };

                if (currentLocation) {
                    options.currentLat = currentLocation.lat;
                    options.currentLon = currentLocation.lon;
                }

                if (location.trim().length >= 2) {
                    const response = await getLocationSuggestions(options);
                    setLocationSuggestions(response.suggestions);

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
                backdropFilter: 'blur(4px)',
            }}
            onClick={onClose}
        >
            <GlassCard
                style={{
                    width: '90%',
                    maxWidth: '450px',
                    padding: '24px',
                    maxHeight: '90vh',
                    overflowY: 'auto',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h3 style={{ margin: 0, fontSize: '20px', fontWeight: '600', color: 'var(--ink)', fontFamily: 'var(--font-display)' }}>
                        {event ? 'Edit Event' : 'New Event'}
                    </h3>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '24px',
                            color: 'var(--muted)',
                            lineHeight: 1,
                            padding: '4px',
                        }}
                    >
                        ×
                    </button>
                </div>

                {selectedDate && (
                    <div style={{ marginBottom: '20px', fontSize: '14px', color: 'var(--accent)', fontWeight: 500 }}>
                        {selectedDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    </div>
                )}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <Input
                        label="Title *"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Event title"
                        required
                        autoFocus
                    />

                    <Textarea
                        label="Description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Add details about this event..."
                        rows={3}
                    />

                    <div style={{ position: 'relative' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', marginLeft: '2px' }}>
                                Location
                            </label>
                            {currentLocation && (
                                <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
                                    📍 Using your location
                                </span>
                            )}
                        </div>
                        <div style={{ position: 'relative' }}>
                            <Input
                                ref={locationInputRef}
                                value={location}
                                onChange={(e) => {
                                    setLocation(e.target.value);
                                    setShowLocationDropdown(true);
                                }}
                                onFocus={() => {
                                    if (location.trim().length >= 2 && locationSuggestions.length > 0) {
                                        setShowLocationDropdown(true);
                                    }
                                }}
                                placeholder="Search locations..."
                                style={{ paddingRight: locationLoading ? '36px' : '12px' }}
                                onBlur={() => {
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
                                        top: '40px', // Adjusted for label
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
                            <GlassCard
                                ref={locationDropdownRef}
                                style={{
                                    position: 'absolute',
                                    top: '100%',
                                    left: 0,
                                    right: 0,
                                    marginTop: '6px',
                                    padding: '0',
                                    maxHeight: '280px',
                                    overflowY: 'auto',
                                    zIndex: 1001,
                                    background: 'var(--panel)',
                                }}
                            >
                                {locationSuggestions.map((suggestion, idx) => (
                                    <div
                                        key={`${suggestion.name}-${idx}`}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            const locationValue = suggestion.full_address || suggestion.name;
                                            setLocation(locationValue);
                                            setShowLocationDropdown(false);
                                        }}
                                        onMouseDown={(e) => e.preventDefault()}
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
                                        className="hover:bg-black/5 dark:hover:bg-white/5"
                                    >
                                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                            <span style={{ fontWeight: 500 }}>{suggestion.name}</span>
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
                                                fontSize: '11px',
                                                color: 'var(--muted)',
                                                marginLeft: '12px',
                                                whiteSpace: 'nowrap',
                                            }}>
                                                {suggestion.distance.toFixed(1)} mi
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </GlassCard>
                        )}
                    </div>

                    <div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500, color: 'var(--ink)', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={allDay}
                                onChange={(e) => setAllDay(e.target.checked)}
                                style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: 'var(--accent)' }}
                            />
                            All day event
                        </label>
                    </div>

                    {!allDay && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                            <Input
                                label="Start Time"
                                type="time"
                                value={startTime}
                                onChange={(e) => setStartTime(e.target.value)}
                            />
                            <Input
                                label="End Time"
                                type="time"
                                value={endTime}
                                onChange={(e) => setEndTime(e.target.value)}
                            />
                        </div>
                    )}

                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--muted)', marginLeft: '2px' }}>
                            Color
                        </label>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            {colorOptions.map((c) => (
                                <button
                                    key={c}
                                    type="button"
                                    onClick={() => setColor(c)}
                                    style={{
                                        width: '36px',
                                        height: '36px',
                                        borderRadius: '50%',
                                        background: c,
                                        border: '2px solid',
                                        borderColor: color === c ? 'var(--ink)' : 'transparent',
                                        cursor: 'pointer',
                                        transition: 'transform 0.2s',
                                    }}
                                    title={c}
                                />
                            ))}
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '12px' }}>
                        {onDelete && (
                            <Button
                                variant="danger"
                                type="button"
                                onClick={onDelete}
                                isLoading={loading}
                            >
                                Delete
                            </Button>
                        )}
                        <Button
                            variant="secondary"
                            type="button"
                            onClick={onClose}
                            disabled={loading}
                            style={{ marginLeft: 'auto' }}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            isLoading={loading}
                            disabled={!title.trim()}
                        >
                            {event ? 'Update' : 'Create'}
                        </Button>
                    </div>
                </form>
            </GlassCard>
        </div>
    );
}
