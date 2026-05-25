window.addEventListener('load', () => {
  const img = new Image();
  img.src = '../icons/peaks_source.png';
  
  img.onload = () => {
    const sizes = [16, 48, 128];
    sizes.forEach(size => {
      const canvas = document.getElementById(`canvas-${size}`);
      const ctx = canvas.getContext('2d');
      
      // Clear and draw SVG
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
    });
  };

  document.getElementById('download-all-btn').addEventListener('click', () => {
    const sizes = [16, 48, 128];
    sizes.forEach(size => {
      const canvas = document.getElementById(`canvas-${size}`);
      const dataURL = canvas.toDataURL('image/png');
      
      const a = document.createElement('a');
      a.href = dataURL;
      a.download = `icon-${size}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  });
});
