'use client';

import React, { useState } from 'react';
import { createTask, type TaskCreate } from '../../api-client';
import Button from '../ui/Button';
import GlassCard from '../ui/GlassCard';
import { Input, Select } from '../ui/Input';
import Textarea from '../ui/Textarea';

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

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'}/calendar/locations/suggestions?query=${encodeURIComponent(query)}`
      );
      if (response.ok) {
        const data = await response.json();
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
      <Button
        variant="primary"
        onClick={() => setIsOpen(true)}
        style={{
          padding: '12px 24px',
          fontWeight: 600,
        }}
      >
        + Add New Task
      </Button>
    );
  }

  return (
    <GlassCard style={{ padding: '24px', marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--ink)' }}>Quick Add Task</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsOpen(false)}
          style={{ width: '32px', height: '32px', padding: 0 }}
        >
          ×
        </Button>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
              Task Title
            </label>
            <Input
              type="text"
              value={formData.title || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              required
              placeholder="What needs to be done?"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
                Estimated Duration
              </label>
              <Input
                type="number"
                value={formData.estimated_minutes || 60}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData(prev => ({ ...prev, estimated_minutes: parseInt(e.target.value) || 60 }))}
                min="5"
                step="5"
                placeholder="Minutes"
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
                Priority
              </label>
              <Select
                value={formData.priority || 'medium'}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFormData(prev => ({ ...prev, priority: e.target.value as any }))}
              >
                <option value="low">Low Priority</option>
                <option value="medium">Medium Priority</option>
                <option value="high">High Priority</option>
              </Select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
                Energy Requirement
              </label>
              <Select
                value={formData.energy || 'med'}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFormData(prev => ({ ...prev, energy: e.target.value as any }))}
              >
                <option value="low">Chill (Low)</option>
                <option value="med">Focused (Med)</option>
                <option value="high">Intense (High)</option>
              </Select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
                Due Date
              </label>
              <Input
                type="date"
                value={formData.due_date || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData(prev => ({ ...prev, due_date: e.target.value || null }))}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
              Location
            </label>
            <Input
              type="text"
              value={formData.location || ''}
              onChange={(e) => {
                setFormData(prev => ({ ...prev, location: e.target.value }));
                if (e.target.value.length >= 2) {
                  handleLocationSearch(e.target.value);
                }
              }}
              placeholder="e.g., Campus Library, Office"
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
              Additional Notes
            </label>
            <Textarea
              value={formData.notes || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value || null }))}
              rows={3}
              placeholder="Context or specific instructions..."
            />
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '12px' }}>
            <Button variant="ghost" onClick={() => setIsOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={loading}>
              {loading ? 'Creating...' : 'Create Task'}
            </Button>
          </div>
        </div>
      </form>
    </GlassCard>
  );
}

