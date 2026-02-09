
import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import tippy from 'tippy.js';
import { SlashCommandList } from './SlashCommandList';

export const SlashCommand = Extension.create({
    name: 'slashCommand',

    addOptions() {
        return {
            suggestion: {
                char: '/',
                command: ({ editor, range, props }: { editor: any; range: any; props: any }) => {
                    props.command({ editor, range });
                },
            },
        };
    },

    addProseMirrorPlugins() {
        return [
            Suggestion({
                editor: this.editor,
                ...this.options.suggestion,
            }),
        ];
    },
});

export const getSuggestionItems = ({ query }: { query: string }) => {
    return [
        {
            title: 'Diagram',
            description: 'Generate a Mermaid diagram with AI',
            searchTerms: ['diagram', 'chart', 'graph', 'draw'],
            command: ({ editor, range }: { editor: any; range: any }) => {
                // We'll handle the prompting in the UI or via a callback
                // For now, we insert a placeholder or trigger the fill command
                const topic = prompt('What diagram would you like to generate?');
                if (topic) {
                    // Insert a placeholder while generating? 
                    // Or just text for now to match the /fill API expectation
                    // actually, the /fill API is a backend endpoint. 
                    // The frontend should probably call it.
                    // For MVP, let's just insert the command text like "/fill diagram: topic" 
                    // and let the user hit enter? 
                    // OR better: call the API immediately.

                    // Let's insert a code block with a loading state or similar.
                    // Actually, the simplest integration with the existing "Slash Command" UX 
                    // is to trigger the action.

                    // We will emit a custom event or callback that LectureEditor listens to.
                    editor.chain().focus().deleteRange(range).run();
                    if (editor.storage.slashCommand?.onTrigger) {
                        editor.storage.slashCommand.onTrigger('diagram', topic);
                    }
                }
            },
        },
        {
            title: 'Web Snapshot',
            description: 'Fetch and summarize a web page',
            searchTerms: ['web', 'search', 'snapshot', 'browse'],
            command: ({ editor, range }: { editor: any; range: any }) => {
                const query = prompt('What would you like to search for?');
                if (query) {
                    editor.chain().focus().deleteRange(range).run();
                    if (editor.storage.slashCommand?.onTrigger) {
                        editor.storage.slashCommand.onTrigger('web', query);
                    }
                }
            },
        },
        {
            title: 'Link Concept',
            description: 'Link to an existing concept',
            searchTerms: ['link', 'connect', 'reference'],
            command: ({ editor, range }: { editor: any; range: any }) => {
                // Trigger the existing concept linking flow
                editor.chain().focus().deleteRange(range).run();
                // We can simulate typing @ maybe? 
                editor.chain().focus().insertContent('@').run();
            },
        },
        {
            title: 'Heading 1',
            description: 'Big section heading',
            searchTerms: ['h1', 'heading', 'title'],
            command: ({ editor, range }: { editor: any; range: any }) => {
                editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run();
            },
        },
        {
            title: 'Heading 2',
            description: 'Medium section heading',
            searchTerms: ['h2', 'heading', 'subtitle'],
            command: ({ editor, range }: { editor: any; range: any }) => {
                editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run();
            },
        },
        {
            title: 'Code Block',
            description: 'Code snippet with syntax highlighting',
            searchTerms: ['code', 'snippet', 'pre'],
            command: ({ editor, range }: { editor: any; range: any }) => {
                editor.chain().focus().deleteRange(range).setNode('codeBlock').run();
            },
        },
    ].filter(item => {
        if (typeof query === 'string' && query.length > 0) {
            const search = query.toLowerCase();
            return (
                item.title.toLowerCase().includes(search) ||
                item.description.toLowerCase().includes(search) ||
                (item.searchTerms && item.searchTerms.some(term => term.includes(search)))
            );
        }
        return true;
    }).slice(0, 10);
};

export const renderItems = () => {
    let component: ReactRenderer<SlashCommandList, any> | null = null;
    let popup: any[] | null = null;

    return {
        onStart: (props: any) => {
            component = new ReactRenderer(SlashCommandList, {
                props,
                editor: props.editor,
            });

            if (!props.clientRect) {
                return;
            }

            const getReferenceClientRect = props.clientRect;
            // Add a check to ensure getReferenceClientRect returns a valid object
            if (!getReferenceClientRect) {
                return;
            }

            popup = tippy('body', {
                getReferenceClientRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
            });
        },

        onUpdate(props: any) {
            component?.updateProps(props);

            if (!props.clientRect) {
                return;
            }

            popup?.[0]?.setProps({
                getReferenceClientRect: props.clientRect,
            });
        },

        onKeyDown(props: any) {
            if (props.event.key === 'Escape') {
                popup?.[0]?.hide();

                return true;
            }

            return component?.ref?.onKeyDown(props);
        },

        onExit() {
            popup?.[0]?.destroy();
            component?.destroy();
        },
    };
};
