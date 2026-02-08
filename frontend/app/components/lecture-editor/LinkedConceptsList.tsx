'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getLectureMentions, getAllGraphData, type LectureMention, type Concept } from '../../api-client';

interface LinkedConceptsListProps {
    lectureId?: string;
    editor?: any;
    content?: string;
}

interface DetectedConcept {
    concept: Concept;
    isLinked: boolean;
    mentionId?: string;
}

export function LinkedConceptsList({ lectureId, editor, content }: LinkedConceptsListProps) {
    const router = useRouter();
    const [detectedConcepts, setDetectedConcepts] = useState<DetectedConcept[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!editor && !content) {
            setDetectedConcepts([]);
            return;
        }

        let isActive = true;
        setLoading(true);

        async function detectConcepts() {
            try {
                // Get the text content from either the editor or the content prop
                let editorText = '';
                if (content) {
                    // Simple HTML strip
                    editorText = content.replace(/<[^>]*>/g, ' ');
                } else if (editor) {
                    editorText = editor.getText();
                }

                if (!editorText.trim()) return;

                // Load all concepts from the graph
                const graphData = await getAllGraphData();
                const allConcepts = graphData.nodes as Concept[];

                // Load manually linked mentions if lectureId exists
                let linkedMentions: LectureMention[] = [];
                if (lectureId) {
                    try {
                        linkedMentions = await getLectureMentions(lectureId);
                    } catch (err) {
                        console.error('Failed to load mentions:', err);
                    }
                }

                // Find all concepts that appear in the text
                const foundConcepts: DetectedConcept[] = [];
                const seenConceptIds = new Set<string>();

                allConcepts.forEach((concept) => {
                    // Skip if we've already added this concept
                    if (seenConceptIds.has(concept.node_id)) return;

                    // Check if this concept appears in the text using word boundaries
                    const conceptName = concept.name;
                    // Escape regex special characters
                    const escapedName = conceptName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                    // PERFORMANCE: Use indexof first before regex for speed
                    if (editorText.toLowerCase().includes(conceptName.toLowerCase())) {
                        const wordBoundaryRegex = new RegExp(`\\b${escapedName}\\b`, 'i');
                        if (wordBoundaryRegex.test(editorText)) {
                            // Check if it's manually linked
                            const linkedMention = linkedMentions.find(
                                m => m.concept.node_id === concept.node_id
                            );

                            foundConcepts.push({
                                concept,
                                isLinked: !!linkedMention,
                                mentionId: linkedMention?.mention_id,
                            });

                            seenConceptIds.add(concept.node_id);
                        }
                    }
                });

                // Sort: linked concepts first, then alphabetically
                foundConcepts.sort((a, b) => {
                    if (a.isLinked && !b.isLinked) return -1;
                    if (!a.isLinked && b.isLinked) return 1;
                    return a.concept.name.localeCompare(b.concept.name);
                });

                if (isActive) {
                    // Only update if changed to prevent re-renders/flashing
                    setDetectedConcepts(prev => {
                        const prevIds = prev.map(p => p.concept.node_id).join(',');
                        const newIds = foundConcepts.map(p => p.concept.node_id).join(',');
                        if (prevIds === newIds) return prev;
                        return foundConcepts;
                    });
                    setLoading(false);
                }
            } catch (error) {
                console.error('[LinkedConceptsList] Failed to detect concepts:', error);
                if (isActive) {
                    setLoading(false);
                }
            }
        }

        detectConcepts();

        // Re-detect when editor content changes
        const updateHandler = () => {
            detectConcepts();
        };

        if (editor) {
            editor.on('update', updateHandler);
        }

        return () => {
            isActive = false;
            if (editor) {
                editor.off('update', updateHandler);
            }
        };
    }, [lectureId, editor, content]);

    const handleConceptClick = (detectedConcept: DetectedConcept) => {
        // First, try to highlight the concept in the editor
        if (editor) {
            highlightConceptInEditor(detectedConcept);
        }

        // Then navigate to the graph explorer with this concept
        router.push(`/graph?node=${detectedConcept.concept.node_id}`);
    };

    const highlightConceptInEditor = (detectedConcept: DetectedConcept) => {
        if (!editor) return;

        try {
            // If it's a linked concept, find by mention ID
            if (detectedConcept.mentionId) {
                const elements = document.querySelectorAll(`[data-mention-id="${detectedConcept.mentionId}"]`);
                if (elements.length > 0) {
                    scrollAndHighlight(elements[0] as HTMLElement);
                    return;
                }
            }

            // Otherwise, find by concept name in the text
            const conceptName = detectedConcept.concept.name;
            const elements = document.querySelectorAll('.concept-hover-trigger, .concept-link');

            for (const element of Array.from(elements)) {
                if (element.textContent?.toLowerCase().includes(conceptName.toLowerCase())) {
                    scrollAndHighlight(element as HTMLElement);
                    return;
                }
            }

            // Fallback: search all text content
            const allElements = document.querySelectorAll('.ProseMirror p, .ProseMirror h1, .ProseMirror h2, .ProseMirror h3');
            for (const element of Array.from(allElements)) {
                if (element.textContent?.toLowerCase().includes(conceptName.toLowerCase())) {
                    scrollAndHighlight(element as HTMLElement);
                    return;
                }
            }
        } catch (error) {
            console.error('Failed to highlight concept:', error);
        }
    };

    const scrollAndHighlight = (element: HTMLElement) => {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });

        const originalBackground = element.style.backgroundColor;
        const originalTransition = element.style.transition;

        element.style.transition = 'background-color 0.3s ease';
        element.style.backgroundColor = 'rgba(37, 99, 235, 0.3)';

        setTimeout(() => {
            element.style.backgroundColor = originalBackground;
            setTimeout(() => {
                element.style.transition = originalTransition;
            }, 300);
        }, 2000);
    };

    if (!editor && !content) {
        return null;
    }

    if (loading) {
        return (
            <div style={{
                padding: '12px 16px',
                fontSize: '12px',
                color: 'var(--muted)'
            }}>
                Detecting concepts...
            </div>
        );
    }

    if (detectedConcepts.length === 0) {
        return (
            <div style={{
                padding: '12px 16px',
                fontSize: '12px',
                color: 'var(--muted)',
                fontStyle: 'italic'
            }}>
                No concepts detected
            </div>
        );
    }

    return (
        <div style={{ padding: '8px 0' }}>
            {detectedConcepts.map((detected) => (
                <div
                    key={detected.concept.node_id}
                    onClick={() => handleConceptClick(detected)}
                    style={{
                        padding: '8px 16px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        color: 'var(--ink)',
                        borderLeft: '3px solid transparent',
                        transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(37, 99, 235, 0.08)';
                        e.currentTarget.style.borderLeftColor = 'var(--accent)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.borderLeftColor = 'transparent';
                    }}
                >
                    <div style={{
                        fontWeight: 500,
                        marginBottom: '2px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                    }}>
                        <span style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            background: detected.isLinked ? 'var(--accent)' : 'var(--muted)',
                            display: 'inline-block'
                        }} />
                        {detected.concept.name}
                    </div>
                    {detected.concept.domain && (
                        <div style={{
                            fontSize: '11px',
                            color: 'var(--muted)',
                            marginLeft: '12px'
                        }}>
                            {detected.concept.domain}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
