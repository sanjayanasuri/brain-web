import { Extension } from '@tiptap/core';

export const BlockInk = Extension.create({
    name: 'blockInk',

    addGlobalAttributes() {
        return [
            {
                types: ['paragraph', 'heading', 'codeBlock'],
                attributes: {
                    ink: {
                        default: null,
                        parseHTML: (element) => element.getAttribute('data-ink'),
                        renderHTML: (attributes) => {
                            if (!attributes.ink) {
                                return {};
                            }
                            return {
                                'data-ink': attributes.ink,
                                'style': `--ink-url: url(${attributes.ink})`,
                                'class': 'has-ink-annotation'
                            };
                        },
                    },
                },
            },
        ];
    },
});
