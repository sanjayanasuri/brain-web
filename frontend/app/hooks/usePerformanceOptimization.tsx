'use client';

import { useEffect, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';

interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

interface PerformanceOptions {
  /** Cache TTL in milliseconds (default: 5 minutes) */
  cacheTTL?: number;
  /** Whether to prefetch on hover (default: true) */
  prefetchOnHover?: boolean;
  /** Whether to preload critical resources (default: true) */
  preloadCritical?: boolean;
  /** Intersection observer threshold for prefetching (default: 0.1) */
  intersectionThreshold?: number;
}

/**
 * Performance optimization hook that provides caching, prefetching, and preloading capabilities
 */
export function usePerformanceOptimization(options: PerformanceOptions = {}) {
  const {
    cacheTTL = 5 * 60 * 1000, // 5 minutes
    prefetchOnHover = true,
    preloadCritical = true,
    intersectionThreshold = 0.1
  } = options;

  const router = useRouter();
  const pathname = usePathname();
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const prefetchQueueRef = useRef<Set<string>>(new Set());
  const intersectionObserverRef = useRef<IntersectionObserver | null>(null);

  /**
   * Cache management utilities
   */
  const cache = {
    get: <T,>(key: string): T | null => {
      const entry = cacheRef.current.get(key);
      if (!entry) return null;

      if (Date.now() > entry.expiresAt) {
        cacheRef.current.delete(key);
        return null;
      }

      return entry.data;
    },

    set: <T,>(key: string, data: T, customTTL?: number): void => {
      const ttl = customTTL || cacheTTL;
      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
        expiresAt: Date.now() + ttl
      };
      cacheRef.current.set(key, entry);
    },

    invalidate: (key: string): void => {
      cacheRef.current.delete(key);
    },

    clear: (): void => {
      cacheRef.current.clear();
    },

    size: (): number => {
      return cacheRef.current.size;
    }
  };

  /**
   * Preload critical resources
   */
  const preloadResource = useCallback(async (url: string, type: 'script' | 'style' | 'fetch' = 'fetch') => {
    if (prefetchQueueRef.current.has(url)) return;
    prefetchQueueRef.current.add(url);

    try {
      switch (type) {
        case 'script':
          const script = document.createElement('link');
          script.rel = 'preload';
          script.as = 'script';
          script.href = url;
          document.head.appendChild(script);
          break;

        case 'style':
          const style = document.createElement('link');
          style.rel = 'preload';
          style.as = 'style';
          style.href = url;
          document.head.appendChild(style);
          break;

        case 'fetch':
          // Use fetch with low priority to preload data
          if ('fetch' in window) {
            await fetch(url, {
              method: 'GET',
              priority: 'low' as any, // Future API
            });
          }
          break;
      }
    } catch (error) {
      console.warn('Failed to preload resource:', url, error);
    }
  }, []);

  /**
   * Prefetch route data
   */
  const prefetchRoute = useCallback(async (route: string) => {
    if (prefetchQueueRef.current.has(route)) return;
    prefetchQueueRef.current.add(route);

    try {
      // Use Next.js router prefetch
      router.prefetch(route);

      // Also prefetch API data if available
      const apiEndpoint = getApiEndpointForRoute(route);
      if (apiEndpoint) {
        await preloadResource(apiEndpoint, 'fetch');
      }
    } catch (error) {
      console.warn('Failed to prefetch route:', route, error);
    }
  }, [router, preloadResource]);

  /**
   * Create hover prefetch handler
   */
  const createHoverPrefetch = useCallback((route: string) => {
    if (!prefetchOnHover) return {};

    let hoverTimeout: NodeJS.Timeout;

    return {
      onMouseEnter: () => {
        hoverTimeout = setTimeout(() => {
          prefetchRoute(route);
        }, 100); // Small delay to avoid excessive prefetching
      },
      onMouseLeave: () => {
        if (hoverTimeout) {
          clearTimeout(hoverTimeout);
        }
      }
    };
  }, [prefetchOnHover, prefetchRoute]);

  /**
   * Create intersection observer for viewport-based prefetching
   */
  const createIntersectionPrefetch = useCallback((element: Element, route: string) => {
    if (!intersectionObserverRef.current) {
      intersectionObserverRef.current = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const route = entry.target.getAttribute('data-prefetch-route');
              if (route) {
                prefetchRoute(route);
                intersectionObserverRef.current?.unobserve(entry.target);
              }
            }
          });
        },
        { threshold: intersectionThreshold }
      );
    }

    element.setAttribute('data-prefetch-route', route);
    intersectionObserverRef.current.observe(element);
  }, [prefetchRoute, intersectionThreshold]);

  /**
   * Performance metrics collection
   */
  const metrics = {
    cacheHitRate: (): number => {
      // This would need to be implemented with hit/miss tracking
      return 0; // Placeholder
    },

    averageLoadTime: (): number => {
      // This would need to be implemented with performance tracking
      return 0; // Placeholder
    },

    prefetchEffectiveness: (): number => {
      // This would need to be implemented with usage tracking
      return 0; // Placeholder
    }
  };

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (intersectionObserverRef.current) {
        intersectionObserverRef.current.disconnect();
      }
    };
  }, []);

  /**
   * Cache cleanup on route change
   */
  useEffect(() => {
    // Clear expired cache entries when route changes
    const now = Date.now();
    for (const [key, entry] of cacheRef.current.entries()) {
      if (now > entry.expiresAt) {
        cacheRef.current.delete(key);
      }
    }
  }, [pathname]);

  return {
    cache,
    preloadResource,
    prefetchRoute,
    createHoverPrefetch,
    createIntersectionPrefetch,
    metrics
  };
}

/**
 * Map routes to their corresponding API endpoints for prefetching
 */
function getApiEndpointForRoute(route: string): string | null {
  const routeMap: Record<string, string> = {
    '/': '/api/brain-web/graph',
    '/home': '/api/brain-web/recent',
    '/gaps': '/api/brain-web/gaps',
    '/review': '/api/brain-web/review',
    '/ingest': '/api/brain-web/sources'
  };

  // Handle parameterized routes
  if (route.startsWith('/concepts/')) {
    const conceptId = route.split('/')[2];
    return `/api/brain-web/concept?node_id=${conceptId}`;
  }

  return routeMap[route] || null;
}

/**
 * Component wrapper for performance optimization
 */
export function withPerformanceOptimization<T extends object>(
  Component: React.ComponentType<T>,
  options?: PerformanceOptions
) {
  return function PerformanceOptimizedComponent(props: T) {
    const perf = usePerformanceOptimization(options);

    // Add performance utilities to props if component expects them
    const enhancedProps = {
      ...props,
      performanceUtils: perf
    } as T & { performanceUtils?: ReturnType<typeof usePerformanceOptimization> };

    return <Component {...enhancedProps} />;
  };
}