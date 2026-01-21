import { Node, mergeAttributes } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import tippy, { Instance as TippyInstance } from 'tippy.js';
import { SuggestionOptions } from '@tiptap/suggestion';
import { Suggestion } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { Concept } from '../../api-client';
import { ConceptMentionList, ConceptMentionListRef } from './ConceptMentionList';
import { ConceptMentionNode } from './ConceptMentionNode';

export interface ConceptMentionOptions {
  HTMLAttributes: Record<string, any>;
  onSearch: (query: string) => Promise<Concept[]>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    conceptMention: {
      setConceptMention: (attributes: { id: string; label: string }) => ReturnType;
    };
  }
}

export const ConceptMention = Node.create<ConceptMentionOptions>({
  name: 'conceptMention',

  addOptions() {
    return {
      HTMLAttributes: {},
      onSearch: async () => [],
    };
  },

  group: 'inline',

  inline: true,

  selectable: false,

  atom: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-concept-id'),
        renderHTML: (attributes) => {
          if (!attributes.id) {
            return {};
          }
          return {
            'data-concept-id': attributes.id,
          };
        },
      },
      label: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-label'),
        renderHTML: (attributes) => {
          if (!attributes.label) {
            return {};
          }
          return {
            'data-label': attributes.label,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `span[data-type="${this.name}"]`,
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(
        { 'data-type': this.name },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      `@${node.attrs.label || 'concept'}`,
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const container = document.createElement('span');
      container.style.display = 'inline-block';

      const reactRenderer = new ReactRenderer(ConceptMentionNode, {
        props: {
          nodeId: node.attrs.id,
          label: node.attrs.label,
        },
        editor: this.editor,
      });

      container.appendChild(reactRenderer.element);

      return {
        dom: container,
        destroy: () => {
          reactRenderer.destroy();
        },
      };
    };
  },

  addProseMirrorPlugins() {
    // Only create the plugin if editor is available
    if (!this.editor) {
      return [];
    }

    return [
      Suggestion({
        editor: this.editor,
        char: '@',
        pluginKey: new PluginKey('conceptMention'),
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              {
                type: this.name,
                attrs: {
                  id: props.id,
                  label: props.label,
                },
              },
              {
                type: 'text',
                text: ' ',
              },
            ])
            .run();
        },
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          const nodeBefore = $from.nodeBefore;
          if (nodeBefore && nodeBefore.type.name === 'conceptMention') {
            return false;
          }
          return true;
        },
        items: async ({ query }) => {
          return this.options.onSearch(query);
        },
        render: () => {
          let component: ReactRenderer | null = null;
          let popup: TippyInstance | null = null;

          return {
            onStart: (props) => {
              if (!this.editor) return;

              component = new ReactRenderer(ConceptMentionList, {
                props: {
                  items: props.items,
                  command: props.command,
                },
                editor: this.editor,
              });

              if (!props.clientRect) {
                return;
              }

              popup = tippy(document.body, {
                getReferenceClientRect: props.clientRect as any,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
              });
            },

            onUpdate(props) {
              if (!component) return;

              component.updateProps({
                items: props.items,
                command: props.command,
              });

              if (!props.clientRect || !popup) {
                return;
              }

              popup.setProps({
                getReferenceClientRect: props.clientRect as any,
              });
            },

            onKeyDown(props) {
              if (!popup || !component) return false;

              if (props.event.key === 'Escape') {
                popup.hide();
                return true;
              }

              return (component.ref as ConceptMentionListRef)?.onKeyDown(props) ?? false;
            },

            onExit() {
              if (popup) {
                popup.destroy();
              }
              if (component) {
                component.destroy();
              }
            },
          };
        },
      }),
    ];
  },
});
