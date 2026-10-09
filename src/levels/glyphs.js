/**
 * The six temple glyphs used by the Past's rune puzzle. Drawn with canvas
 * paths (not font characters) so they look identical on every machine — a
 * symbol font missing on the lab's Ubuntu PCs would otherwise break the
 * puzzle.
 */
export const GLYPHS = ['Sun', 'Moon', 'Eye', 'Wave', 'Peak', 'Hourglass'];
export const NUMERALS = ['I', 'II', 'III'];

export function drawGlyph(g, name, cx, cy, size, color = '#2a1d10', width = size * 0.09) {
  const s = size / 2;
  g.save();
  g.translate(cx, cy);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  switch (name) {
    case 'Sun':
      g.arc(0, 0, s * 0.42, 0, Math.PI * 2);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.moveTo(Math.cos(a) * s * 0.62, Math.sin(a) * s * 0.62);
        g.lineTo(Math.cos(a) * s * 0.92, Math.sin(a) * s * 0.92);
      }
      g.stroke();
      break;
    case 'Moon':
      g.arc(0, 0, s * 0.78, Math.PI * 0.35, Math.PI * 1.65);
      g.arc(s * 0.38, 0, s * 0.62, Math.PI * 1.45, Math.PI * 0.55, true);
      g.closePath();
      g.stroke();
      break;
    case 'Eye':
      g.moveTo(-s * 0.9, 0);
      g.quadraticCurveTo(0, -s * 0.85, s * 0.9, 0);
      g.quadraticCurveTo(0, s * 0.85, -s * 0.9, 0);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, s * 0.24, 0, Math.PI * 2);
      g.fill();
      break;
    case 'Wave':
      for (let k = -1; k <= 1; k++) {
        const y = k * s * 0.42;
        g.moveTo(-s * 0.85, y);
        for (let i = 0; i <= 24; i++) {
          const x = -s * 0.85 + (i / 24) * s * 1.7;
          g.lineTo(x, y + Math.sin((i / 24) * Math.PI * 4) * s * 0.14);
        }
      }
      g.stroke();
      break;
    case 'Peak':
      g.moveTo(-s * 0.9, s * 0.65);
      g.lineTo(-s * 0.3, -s * 0.55);
      g.lineTo(0, s * 0.05);
      g.lineTo(s * 0.35, -s * 0.8);
      g.lineTo(s * 0.9, s * 0.65);
      g.closePath();
      g.stroke();
      break;
    case 'Hourglass':
      g.moveTo(-s * 0.6, -s * 0.8);
      g.lineTo(s * 0.6, -s * 0.8);
      g.lineTo(-s * 0.6, s * 0.8);
      g.lineTo(s * 0.6, s * 0.8);
      g.closePath();
      g.stroke();
      break;
    default: break;
  }
  g.restore();
}

/** Small image for the HTML journal. */
export function glyphDataURL(name, color = '#f2c879') {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  drawGlyph(c.getContext('2d'), name, 32, 32, 52, color, 5);
  return c.toDataURL();
}

/** Weathered sandstone background for carved surfaces. */
export function stoneBackground(g, w, h, base = '#b89b72') {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < (w * h) / 40; i++) {
    const v = Math.random();
    g.fillStyle = v > 0.5 ? 'rgba(255,240,210,0.06)' : 'rgba(60,40,20,0.08)';
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  g.strokeStyle = 'rgba(60,40,20,0.35)';
  g.lineWidth = Math.max(2, w / 80);
  g.strokeRect(g.lineWidth, g.lineWidth, w - g.lineWidth * 2, h - g.lineWidth * 2);
}
