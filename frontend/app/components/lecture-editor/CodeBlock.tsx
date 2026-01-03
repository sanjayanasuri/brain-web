import { CodeBlock as BaseCodeBlock } from '@tiptap/extension-code-block';
import { ReactRenderer } from '@tiptap/react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import React, { useState, useEffect, useRef } from 'react';

interface CodeBlockComponentProps {
  language: string;
  content: string;
  onLanguageChange: (lang: string) => void;
}

const LANGUAGES = [
  'text', 'javascript', 'typescript', 'python', 'java', 'cpp', 'c', 'csharp',
  'go', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'r',
  'sql', 'html', 'css', 'scss', 'json', 'xml', 'yaml', 'toml',
  'bash', 'shell', 'powershell', 'dockerfile', 'markdown', 'diff',
];

const CodeBlockComponent: React.FC<CodeBlockComponentProps> = ({ language, content, onLanguageChange }) => {
  const [isSelecting, setIsSelecting] = useState(false);
  const [currentLang, setCurrentLang] = useState(language || 'text');
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    setCurrentLang(language || 'text');
  }, [language]);

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLang = e.target.value;
    setCurrentLang(newLang);
    onLanguageChange(newLang);
    setIsSelecting(false);
  };

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 10 }}>
        <select
          ref={selectRef}
          value={currentLang}
          onChange={handleLanguageChange}
          onFocus={() => setIsSelecting(true)}
          onBlur={() => setIsSelecting(false)}
          style={{
            background: 'var(--surface)',
            color: 'var(--ink)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            padding: '4px 8px',
            fontSize: '12px',
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          {LANGUAGES.map((lang) => (
            <option key={lang} value={lang}>
              {lang}
            </option>
          ))}
        </select>
      </div>
      <SyntaxHighlighter
        language={currentLang}
        style={oneDark}
        customStyle={{
          margin: 0,
          borderRadius: '8px',
          fontSize: '0.9em',
        }}
        PreTag="div"
      >
        {content}
      </SyntaxHighlighter>
    </div>
  );
};

export const CodeBlock = BaseCodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      language: {
        default: 'text',
        parseHTML: (element) => element.getAttribute('data-language'),
        renderHTML: (attributes) => {
          if (!attributes.language) {
            return {};
          }
          return {
            'data-language': attributes.language,
          };
        },
      },
    };
  },

  addNodeView() {
    return ({ node, editor }) => {
      const container = document.createElement('div');
      container.style.margin = '1.5em 0';
      container.style.overflow = 'auto';

      const language = node.attrs.language || 'text';
      const content = node.textContent;

      const handleLanguageChange = (newLang: string) => {
        editor.commands.updateAttributes('codeBlock', { language: newLang });
      };

      const reactRenderer = new ReactRenderer(CodeBlockComponent, {
        props: {
          language,
          content,
          onLanguageChange: handleLanguageChange,
        },
        editor,
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
});

