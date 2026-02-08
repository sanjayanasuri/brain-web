'use client';

/**
 * Utility functions for managing page breaks in the notebook editor
 */

const LINE_HEIGHT = 28; // pixels
const HEADER_SPACE = 65; // pixels from top to first line
const FOOTER_SPACE = 40; // pixels from bottom for page number
const PAGE_HEIGHT = 1056; // 11" at 96 DPI
const LEFT_MARGIN = 90; // pixels
const RIGHT_MARGIN = 50; // pixels
const PAGE_WIDTH = 816; // 8.5" at 96 DPI

// Calculate usable content area
const CONTENT_WIDTH = PAGE_WIDTH - LEFT_MARGIN - RIGHT_MARGIN; // 676px
const CONTENT_HEIGHT = PAGE_HEIGHT - HEADER_SPACE - FOOTER_SPACE; // 951px
const MAX_LINES_PER_PAGE = Math.floor(CONTENT_HEIGHT / LINE_HEIGHT); // 33 lines

// Approximate characters per line (depends on font, but this is a reasonable estimate)
const AVG_CHAR_WIDTH = 9; // pixels for 16px Crimson Pro
const CHARS_PER_LINE = Math.floor(CONTENT_WIDTH / AVG_CHAR_WIDTH); // ~75 chars

export interface PageBreakResult {
    pages: string[];
    overflow: boolean;
}

/**
 * Split HTML content into pages based on line count
 */
export function splitContentIntoPages(htmlContent: string): PageBreakResult {
    if (!htmlContent || htmlContent.trim() === '') {
        return { pages: [''], overflow: false };
    }

    // Parse HTML and extract text blocks
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');
    const body = doc.body;

    const pages: string[] = [];
    let currentPage: HTMLElement[] = [];
    let currentLineCount = 0;

    // Process each child element
    Array.from(body.children).forEach((element) => {
        const clone = element.cloneNode(true) as HTMLElement;
        const estimatedLines = estimateElementLines(clone);

        // Check if adding this element would exceed page capacity
        if (currentLineCount + estimatedLines > MAX_LINES_PER_PAGE && currentPage.length > 0) {
            // Save current page
            pages.push(serializeElements(currentPage));
            currentPage = [];
            currentLineCount = 0;
        }

        // If single element is too large, split it
        if (estimatedLines > MAX_LINES_PER_PAGE) {
            const splitElements = splitLargeElement(clone, MAX_LINES_PER_PAGE - currentLineCount);

            // Add first part to current page
            if (splitElements.first) {
                currentPage.push(splitElements.first);
                pages.push(serializeElements(currentPage));
                currentPage = [];
                currentLineCount = 0;
            }

            // Add remaining parts as new pages
            if (splitElements.remaining) {
                currentPage.push(splitElements.remaining);
                currentLineCount = estimateElementLines(splitElements.remaining);
            }
        } else {
            currentPage.push(clone);
            currentLineCount += estimatedLines;
        }
    });

    // Add final page if it has content
    if (currentPage.length > 0) {
        pages.push(serializeElements(currentPage));
    }

    // Ensure at least one page
    if (pages.length === 0) {
        pages.push('');
    }

    return {
        pages,
        overflow: pages.length > 1,
    };
}

/**
 * Estimate how many lines an HTML element will take
 */
function estimateElementLines(element: HTMLElement): number {
    const text = element.textContent || '';
    const tagName = element.tagName.toLowerCase();

    // Different elements have different line heights
    switch (tagName) {
        case 'h1':
            return 2; // H1 takes 2 lines (56px / 28px)
        case 'h2':
            return 2; // H2 takes 2 lines
        case 'h3':
            return 1; // H3 takes 1 line
        case 'p':
            // Estimate based on text length
            const lines = Math.ceil(text.length / CHARS_PER_LINE);
            return Math.max(1, lines); // At least 1 line even if empty
        case 'ul':
        case 'ol':
            // Count list items
            const items = element.querySelectorAll('li');
            let totalLines = 0;
            items.forEach((item) => {
                const itemText = item.textContent || '';
                totalLines += Math.max(1, Math.ceil(itemText.length / CHARS_PER_LINE));
            });
            return totalLines;
        case 'pre':
        case 'blockquote':
            // Code blocks and quotes - count newlines
            const codeLines = text.split('\n').length;
            return Math.max(1, codeLines);
        default:
            return Math.max(1, Math.ceil(text.length / CHARS_PER_LINE));
    }
}

/**
 * Split a large element (like a long paragraph) across pages
 */
function splitLargeElement(
    element: HTMLElement,
    remainingLines: number
): { first: HTMLElement | null; remaining: HTMLElement | null } {
    const tagName = element.tagName.toLowerCase();
    const text = element.textContent || '';

    if (tagName === 'p') {
        // Split paragraph text
        const charsForFirstPart = remainingLines * CHARS_PER_LINE;

        if (charsForFirstPart <= 0) {
            return { first: null, remaining: element };
        }

        // Find a good break point (space or punctuation)
        let breakPoint = charsForFirstPart;
        const searchStart = Math.max(0, charsForFirstPart - 20);
        const searchEnd = Math.min(text.length, charsForFirstPart + 20);

        for (let i = charsForFirstPart; i >= searchStart; i--) {
            if (text[i] === ' ' || text[i] === '.' || text[i] === ',' || text[i] === ';') {
                breakPoint = i + 1;
                break;
            }
        }

        const firstText = text.substring(0, breakPoint).trim();
        const remainingText = text.substring(breakPoint).trim();

        const firstElement = element.cloneNode(false) as HTMLElement;
        firstElement.textContent = firstText;

        const remainingElement = element.cloneNode(false) as HTMLElement;
        remainingElement.textContent = remainingText;

        return {
            first: firstText ? firstElement : null,
            remaining: remainingText ? remainingElement : null,
        };
    }

    // For other elements, don't split - just move to next page
    return { first: null, remaining: element };
}

/**
 * Serialize array of HTML elements back to HTML string
 */
function serializeElements(elements: HTMLElement[]): string {
    const container = document.createElement('div');
    elements.forEach((el) => container.appendChild(el.cloneNode(true)));
    return container.innerHTML;
}

/**
 * Merge pages back into single HTML content
 */
export function mergePages(pages: string[]): string {
    return pages.join('\n\n');
}

/**
 * Check if content needs pagination
 */
export function needsPagination(htmlContent: string): boolean {
    const result = splitContentIntoPages(htmlContent);
    return result.overflow;
}
