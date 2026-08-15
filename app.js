// ArbDraw bootstrap. Feature code lives in the ordered scripts under js/.
new ResizeObserver(resize).observe(canvas);
new ResizeObserver(()=>{
  if(!$('waveformView').classList.contains('hidden'))resizeCanvas(scopeCanvas,drawScope);
}).observe(scopeCanvas);

renderDocument();
generate();
