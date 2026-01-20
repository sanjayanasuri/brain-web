'use client';

import React, { useState } from 'react';
import { createTask, type TaskCreate } from '../../api-client';

interface TaskQuickAddProps {
  onTaskCreated?: () => void;
}

export default function TaskQuickAdd({ onTaskCreated }: TaskQuickAddProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<Partial<TaskCreate>>({
    title: '',
    estimated_minutes: 60,
    priority: 'medium',
    energy: 'med',
    tags: [],
    location: '',
    location_lat: undefined,
    location_lon: undefined,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.title || !formData.title.trim()) {
      alert('Please enter a task title');
      return;
    }

    setLoading(true);
    try {
      const payload: TaskCreate = {
        title: formData.title!,
        estimated_minutes: formData.estimated_minutes || 60,
        priority: formData.priority || 'medium',
        energy: formData.energy || 'med',
        notes: formData.notes || null,
        due_date: formData.due_date || null,
        tags: formData.tags || null,
        preferred_time_windows: formData.preferred_time_windows || null,
        dependencies: formData.dependencies || null,
        location: formData.location || null,
        location_lat: formData.location_lat || null,
        location_lon: formData.location_lon || null,
      };
      
      await createTask(payload);
      
      // Reset form
      setFormData({
        title: '',
        estimated_minutes: 60,
        priority: 'medium',
        energy: 'med',
        tags: [],
        location: '',
        location_lat: undefined,
        location_lon: undefined,
      });
      setIsOpen(false);
      
      if (onTaskCreated) {
        onTaskCreated();
      }
    } catch (err) {
      console.error('Failed to create task:', err);
      alert(err instanceof Error ? err.message : 'Failed to create task. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLocationSearch = async (query: string) => {
    if (!query || query.length < 2) {
      return;
    }
    
    // Use the calendar location suggestions API
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'}/calendar/locations/suggestions?query=${encodeURIComponent(query)}`
      );
      if (response.ok) {
        const data = await response.json();
        // For now, just set the location string
        // In a full implementation, you'd show a dropdown and let user select
        if (data.suggestions && data.suggestions.length > 0) {
          const first = data.suggestions[0];
          setFormData(prev => ({
            ...prev,
            location: first.name,
            location_lat: first.lat || undefined,
            location_lon: first.lon || undefined,
          }));
        }
      }
    } catch (err) {
      console.error('Failed to search locations:', err);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        style={{
          padding: '12px 24px',
          background: '#3b82f6',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: 500,
        }}
      >
        + Add Task
      </button>
    );
  }

  return (
    <div style={{
      padding: '20px',
      background: 'var(--card-bg, #ffffff)',
      borderRadius: '8px',
      border: '1px solid var(--border-color, #e5e7eb)',
      marginBottom: '16px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Add New Task</h3>
        <button
          onClick={() => setIsOpen(false)}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '20px',
            cursor: 'pointer',
            color: '#6b7280',
            padding: '0',
            width: '24px',
            height: '24px',
          }}
        >
          ×
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: 500 }}>
              Title *
            </label>
            <input
              type="text"
              value={formData.title || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '14px',
              }}
              placeholder="e.g., Review calculus notes"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: 500 }}>
                Estimated Minutes
              </label>
              <input
                type="number"
                value={formData.estimated_minutes || 60}
                onChange={(e) => setFormData(prev => ({ ...prev, estimated_minutes: parseInt(e.target.value) || 60 }))}
                min="5"
                step="5"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: 500 }}>
                Priority
              </label>
              <select
                value={formData.priority || 'medium'}
                onChange={(e) => setFormData(prev => ({ ...prev, priority: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: 500 }}>
                Energy Level
              </label>
              <select
                value={formData.energy || 'med'}
                onChange={(e) => setFormData(prev => ({ ...prev, energy: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              >
                <option value="low">Low</option>
                <option value="med">Medium</option>
                <option value="high">High</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: 500 }}>
                Due Date (optional)
              </label>
              <input
                type="date"
                value={formData.due_date || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, due_date: e.target.value || null }))}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: 500 }}>
              Location (optional)
            </label>
            <input
              type="text"
              value={formData.location || ''}
              onChange={(e) => {
                setFormData(prev => ({ ...prev, location: e.target.value }));
                if (e.target.value.length >= 2) {
                  handleLocationSearch(e.target.value);
                }
              }}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '14px',
              }}
              placeholder="e.g., WALC, Library"
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: 500 }}>
              Notes (optional)
            </label>
            <textarea
              value={formData.notes || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value || null }))}
              rows={3}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '14px',
                fontFamily: 'inherit',
                resize: 'vertical',
              }}
              placeholder="Additional details..."
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              disabled={loading}
              style={{
                padding: '8px 16px',
                background: '#f3f4f6',
                color: '#374151',
                border: 'none',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '14px',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '8px 16px',
                background: loading ? '#9ca3af' : '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: 500,
              }}
            >
              {loading ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
