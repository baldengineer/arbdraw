// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
(function exposeSvgExport(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ARBDRAW_SVG_EXPORT = api;
})(typeof globalThis === 'object' ? globalThis : this, function createSvgExport() {
  function waveformSvg({ values, name = 'Waveform', includeAxes = false, durationSeconds = 0 }) {
    if (!Array.isArray(values) || !values.length || !values.every(Number.isFinite))
      throw new Error('The waveform must contain finite samples to export SVG.');
    const escapeXml = (value) => String(value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
    let min = Infinity, max = -Infinity;
    for (const value of values) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    const left = includeAxes ? 90 : 12, right = includeAxes ? 1170 : 1188,
      top = includeAxes ? 20 : 12, bottom = includeAxes ? 340 : 388;
    const points = values.map((value, index) => {
      const x = values.length === 1 ? 600 : left + index / (values.length - 1) * (right - left);
      const y = max === min ? (top + bottom) / 2 : bottom - (value - min) / (max - min) * (bottom - top);
      return `${x.toFixed(3)},${y.toFixed(3)}`;
    }).join(' ');
    const grid = [];
    if (includeAxes) {
      const label = (value) => Number(value.toPrecision(4)).toString();
      const span = max === min ? Math.max(1, Math.abs(min) * 0.1) : max - min;
      const axisMin = max === min ? min - span / 2 : min;
      for (let i = 0; i <= 4; i++) {
        const x = left + i / 4 * (right - left), y = bottom - i / 4 * (bottom - top);
        grid.push('<path d="M ' + x + ' ' + top + ' V ' + bottom + ' M ' + left + ' ' + y + ' H ' + right + '" fill="none" stroke="black" stroke-width="0.5" stroke-dasharray="3 5"/>');
        grid.push('<text x="' + x + '" y="362" text-anchor="middle">' + label(durationSeconds * i / 4) + '</text>');
        grid.push('<text x="80" y="' + (y + 4) + '" text-anchor="end">' + label(axisMin + span * i / 4) + '</text>');
      }
      grid.push('<path d="M ' + left + ' ' + top + ' V ' + bottom + ' H ' + right + '" fill="none" stroke="black"/>');
      grid.push('<text x="630" y="389" text-anchor="middle">Time (s)</text><text x="18" y="180" transform="rotate(-90 18 180)" text-anchor="middle">Voltage (V)</text>');
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(name)}</title>
  <desc id="description">${values.length} evenly spaced waveform samples. Voltage range: ${min} to ${max} V. Transparent background.</desc>
  <g fill="black" font-family="sans-serif" font-size="12">${grid.join('')}</g>
  <polyline points="${points}" fill="none" stroke="black" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
</svg>
`;
  }
  return Object.freeze({ waveformSvg });
});
