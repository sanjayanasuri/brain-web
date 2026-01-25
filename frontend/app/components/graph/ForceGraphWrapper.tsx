'use client';

import { forwardRef, useImperativeHandle, useRef } from 'react';
import dynamic from 'next/dynamic';

// Dynamically import ForceGraph2D
const ForceGraph2DBase = dynamic(
    () => import('react-force-graph-2d'),
    { ssr: false }
);

/**
 * Create a wrapper component that properly forwards refs.
 * 
 * IMPORTANT: Next.js dynamic() creates a LoadableComponent wrapper that doesn't support refs.
 * We work around this by using a ref callback that doesn't trigger React's ref validation.
 * The warning you see is expected and harmless - the ref forwarding works correctly.
 */
export const ForceGraph2DWithRef = forwardRef<any, any>((props, ref) => {
    const internalRef = useRef<any>(null);
    const refCallback = useRef<((instance: any) => void) | null>(null);

    // Set up the ref callback once
    if (!refCallback.current) {
        refCallback.current = (instance: any) => {
            if (instance) {
                internalRef.current = instance;
                // Forward to parent ref
                if (ref) {
                    if (typeof ref === 'function') {
                        ref(instance);
                    } else if (ref && 'current' in ref) {
                        ref.current = instance;
                    }
                }
            }
        };
    }

    // Forward the ref using useImperativeHandle as backup
    useImperativeHandle(ref, () => internalRef.current, []);

    // Use the stable callback ref
    // @ts-expect-error - LoadableComponent doesn't officially support refs but callback refs work
    return <ForceGraph2DBase {...props} ref={refCallback.current} />;
});

ForceGraph2DWithRef.displayName = 'ForceGraph2DWithRef';
