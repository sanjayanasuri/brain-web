/**
 * Wikipedia API utilities for fetching article summaries and information
 */

export interface WikipediaSummary {
  title: string;
  extract: string;
  pageid: number;
  thumbnail?: {
    source: string;
    width: number;
    height: number;
  };
  fullurl: string;
  description?: string;
}

export interface WikipediaSearchResult {
  title: string;
  pageid: number;
  snippet: string;
  fullurl: string;
}

/**
 * Fetch Wikipedia summary for a given term
 * Uses the Wikipedia API to get a short extract (summary) of the article
 */
export async function fetchWikipediaSummary(term: string): Promise<WikipediaSummary | null> {
  try {
    // Clean the term - remove special characters and normalize
    const cleanTerm = term.trim().replace(/[^\w\s-]/g, '');
    if (!cleanTerm || cleanTerm.length < 2) {
      return null;
    }

    // Wikipedia API endpoint for getting extracts
    const apiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanTerm)}`;
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      // Try searching if direct lookup fails
      return await searchWikipedia(term);
    }

    const data = await response.json();
    
    // Check if we got a valid page (not a disambiguation or missing page)
    if (data.type === 'standard' && data.extract) {
      return {
        title: data.title,
        extract: data.extract,
        pageid: data.pageid,
        thumbnail: data.thumbnail,
        fullurl: data.content_urls?.desktop?.page || data.content_urls?.mobile?.page || '',
        description: data.description,
      };
    }

    // If not a standard page, try search
    return await searchWikipedia(term);
  } catch (error) {
    console.error('Error fetching Wikipedia summary:', error);
    return null;
  }
}

/**
 * Search Wikipedia for a term and return the best match
 */
async function searchWikipedia(term: string): Promise<WikipediaSummary | null> {
  try {
    const cleanTerm = term.trim();
    if (!cleanTerm || cleanTerm.length < 2) {
      return null;
    }

    // Wikipedia search API
    const searchUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanTerm)}`;
    
    // First try the exact term
    const response = await fetch(searchUrl);
    if (response.ok) {
      const data = await response.json();
      if (data.type === 'standard' && data.extract) {
        return {
          title: data.title,
          extract: data.extract,
          pageid: data.pageid,
          thumbnail: data.thumbnail,
          fullurl: data.content_urls?.desktop?.page || data.content_urls?.mobile?.page || '',
          description: data.description,
        };
      }
    }

    // If that fails, try search API
    const searchApiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanTerm)}&format=json&origin=*&srlimit=1`;
    const searchResponse = await fetch(searchApiUrl);
    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      const searchResults = searchData.query?.search;
      if (searchResults && searchResults.length > 0) {
        const firstResult = searchResults[0];
        // Fetch the summary for the first result
        return await fetchWikipediaSummary(firstResult.title);
      }
    }

    return null;
  } catch (error) {
    console.error('Error searching Wikipedia:', error);
    return null;
  }
}

/**
 * Extract potential Wikipedia-worthy terms from text
 * This is a simple heuristic - looks for capitalized words/phrases
 */
export function extractPotentialTerms(text: string): string[] {
  const terms: string[] = [];
  
  // Filter out common false positives
  const commonWords = new Set([
    'The', 'This', 'That', 'These', 'Those',
    'When', 'Where', 'What', 'Why', 'How',
    'From', 'With', 'About', 'After', 'Before',
  ]);
  
  // Match capitalized words/phrases (2+ words, each starting with capital)
  const capitalizedPhraseRegex = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
  const matches = text.match(capitalizedPhraseRegex);
  
  if (matches) {
    matches.forEach(match => {
      const words = match.split(/\s+/);
      // Only include if not all words are common words
      if (words.some(word => !commonWords.has(word))) {
        terms.push(match);
      }
    });
  }
  
  // Also match single capitalized words that might be proper nouns
  const singleCapitalizedRegex = /\b[A-Z][a-z]{3,}\b/g;
  const singleMatches = text.match(singleCapitalizedRegex);
  
  if (singleMatches) {
    singleMatches.forEach(match => {
      if (!commonWords.has(match) && !terms.includes(match)) {
        terms.push(match);
      }
    });
  }
  
  return [...new Set(terms)]; // Remove duplicates
}

