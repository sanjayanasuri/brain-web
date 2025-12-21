'use client';

import React, { useEffect, useRef } from 'react';

type ForceGraphLikeRef = {
  current: null | {
    getGraphData?: () => any;
    graphData?: () => any;
  };
};

export default function GraphMiniMap({
  graphRef,
  size = 160,
}: {
  graphRef: ForceGraphLikeRef;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      const fg = graphRef.current;
      if (!canvas || !fg) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        raf = requestAnimationFrame(draw);
        return;
      }

      const data = fg.getGraphData ? fg.getGraphData() : fg.graphData ? fg.graphData() : null;
      const nodes: any[] = data?.nodes || [];
      const pts = nodes.filter((n) => n && typeof n.x === 'number' && typeof n.y === 'number');

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Background card
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.10)';
      ctx.lineWidth = 1;
      const r = 12;
      const w = canvas.width;
      const h = canvas.height;
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.arcTo(w, 0, w, h, r);
      ctx.arcTo(w, h, 0, h, r);
      ctx.arcTo(0, h, 0, 0, r);
      ctx.arcTo(0, 0, w, 0, r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      if (pts.length === 0) {
        raf = requestAnimationFrame(draw);
        return;
      }

      // Fit bounds
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < pts.length; i += 1) {
        const n = pts[i];
        if (n.x < minX) minX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.x > maxX) maxX = n.x;
        if (n.y > maxY) maxY = n.y;
      }
      const pad = 14;
      const dx = Math.max(1e-6, maxX - minX);
      const dy = Math.max(1e-6, maxY - minY);
      const scale = Math.min((w - pad * 2) / dx, (h - pad * 2) / dy);

      ctx.save();
      ctx.translate(pad, pad);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
      ctx.globalAlpha = 0.75;
      for (let i = 0; i < pts.length; i += 1) {
        const n = pts[i];
        const x = (n.x - minX) * scale;
        const y = (n.y - minY) * scale;
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, 2 * Math.PI, false);
        ctx.fill();
      }
      ctx.restore();

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [graphRef]);

  return <canvas ref={canvasRef} width={size} height={size} className="graph-mini-map" />;
}

