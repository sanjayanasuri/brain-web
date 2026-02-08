'use client';

import { forwardRef, useImperativeHandle, useRef } from 'react';
import dynamic from 'next/dynamic';

// Dynamically import the component with a wrapper that handles the ref
const ForceGraph2DInner = dynamic(
    () => import('react-force-graph-2d').then(mod => {
        const ForceGraph2D = mod.default;
        // Return a component that accepts forwardedRef
        const Wrapper = ({ forwardedRef, ...props }: any) => (
            <ForceGraph2D {...props} ref={forwardedRef} />
        );
        Wrapper.displayName = 'ForceGraph2DWrapper';
        return Wrapper;
    }),
    { ssr: false }
);

/**
 * Create a wrapper component that properly forwards refs.
 */
export const ForceGraph2DWithRef = forwardRef<any, any>((props, ref) => {
    return <ForceGraph2DInner {...props} forwardedRef={ref} />;
});

ForceGraph2DWithRef.displayName = 'ForceGraph2DWithRef';
