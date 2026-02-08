
export const getCursorForTool = (tool: 'pen' | 'highlighter' | 'eraser' | 'lasso', color: string, width: number): string => {
    const encodedColor = encodeURIComponent(color);

    if (tool === 'pen') {
        // A simple pen tip pointing bottom-left (standard direction is top-left, but for writing usually pen holds differently)
        // Actually standard cursor hotspot is 0,0 (top left). Let's make the tip at 0,16 or similar.
        // Let's stick to standard top-left pointer style for simplicity, or 
        // a classic pen angled at 45 deg.
        // Tip at (0, 32) (bottom left) is mimicry of holding?
        // Standard cursors usually have hot spot at top-left (0,0).
        // Let's make a pen that points to 0,32 (bottom-left) and set hotspot there.
        // Or simpler: Tip at 0,0.

        // Pen Icon: angled \ 
        const svg = `
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 28L8 28L26 10L22 6L4 24L4 28Z" fill="${encodedColor}" stroke="white" stroke-width="1"/>
        <path d="M4 28L6 26" stroke="white" stroke-width="1"/>
      </svg>
    `.trim().replace(/\s+/g, ' ');

        return `url('data:image/svg+xml;utf8,${svg}') 0 32, crosshair`;
    }

    if (tool === 'highlighter') {
        // Highlighter: Wide rectangular tip, maybe translucent
        // Angled /
        const svg = `
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
         <rect x="4" y="20" width="20" height="8" transform="rotate(-45 14 24)" fill="${encodedColor}" fill-opacity="0.5" stroke="white" stroke-width="1"/>
      </svg>
    `.trim().replace(/\s+/g, ' ');
        return `url('data:image/svg+xml;utf8,${svg}') 16 16, crosshair`;
    }

    if (tool === 'eraser') {
        // Eraser: Circle or Block
        const svg = `
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="10" fill="white" stroke="#333" stroke-width="2"/>
        <line x1="10" y1="10" x2="22" y2="22" stroke="#333" stroke-width="1"/>
        <line x1="22" y1="10" x2="10" y2="22" stroke="#333" stroke-width="1"/>
      </svg>
    `.trim().replace(/\s+/g, ' ');
        return `url('data:image/svg+xml;utf8,${svg}') 16 16, crosshair`;
    }

    if (tool === 'lasso') {
        // Lasso loop
        const svg = `
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 10 C 20 5, 25 15, 20 20 C 15 25, 5 20, 10 10" stroke="#333" stroke-width="2" stroke-dasharray="2 2" fill="none"/>
        <circle cx="10" cy="10" r="2" fill="#333"/>
      </svg>
     `.trim().replace(/\s+/g, ' ');
        return `url('data:image/svg+xml;utf8,${svg}') 10 10, crosshair`;
    }

    return 'crosshair';
};
