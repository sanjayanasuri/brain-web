import { useEffect, useState } from 'react';
import type React from 'react';

function detectIPadLikeDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  const ua = navigator.userAgent || '';
  const platform = (navigator as Navigator & { platform?: string }).platform || '';
  const maxTouchPoints = navigator.maxTouchPoints || 0;

  const isiPadUA = /iPad/i.test(ua);
  const isiPadDesktopUA = /Macintosh/i.test(ua) && maxTouchPoints > 1;
  const isiPadPlatform = /iPad/i.test(platform) || (platform === 'MacIntel' && maxTouchPoints > 1);

  return isiPadUA || isiPadDesktopUA || isiPadPlatform;
}

export function useIPadLikeDevice(): boolean {
  const [isIPadLike, setIsIPadLike] = useState(false);

  useEffect(() => {
    const update = () => setIsIPadLike(detectIPadLikeDevice());
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return isIPadLike;
}

export function focusOnPenPointerDown<T extends HTMLElement>(e: React.PointerEvent<T>) {
  if (e.pointerType === 'pen') {
    e.currentTarget.focus();
  }
}

export function getScribbleInputStyle(
  isIPadLike: boolean,
  kind: 'singleline' | 'multiline' = 'singleline',
): React.CSSProperties {
  if (!isIPadLike) {
    return {
      touchAction: 'manipulation',
      WebkitUserSelect: 'text',
      userSelect: 'text',
    };
  }

  return {
    fontSize: '16px', // Prevents Safari zoom and feels natural for Scribble.
    lineHeight: kind === 'multiline' ? '1.5' : '1.35',
    minHeight: kind === 'multiline' ? '52px' : '44px',
    paddingTop: kind === 'multiline' ? '12px' : undefined,
    paddingBottom: kind === 'multiline' ? '12px' : undefined,
    borderRadius: kind === 'multiline' ? '12px' : '10px',
    touchAction: 'manipulation',
    WebkitUserSelect: 'text',
    userSelect: 'text',
    WebkitTouchCallout: 'default',
    caretColor: 'var(--ink)',
  };
}

export const scribbleInputProps = {
  autoCorrect: 'on' as const,
  autoCapitalize: 'sentences' as const,
  spellCheck: true,
  inputMode: 'text' as const,
};
