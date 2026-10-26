"""Observe decoded pixels without relying on JPEG events or decoder internals.

Canvas observations count visible pixel changes, not raw RFB messages or screen
refreshes. The animated acceptance page changes the sampled background itself.
"""

START_RENDER_SAMPLING = """root => {
    window.stopBrowserViewMeasurements?.();
    window.browserViewMeasurements = [];
    const probe = document.createElement('canvas');
    probe.width = probe.height = 1;
    const context = probe.getContext('2d', {willReadFrequently:true});
    let previousSource, previousKey, previousRGB, animation;
    const sample = () => {
        const source = root.querySelector('canvas[aria-label], canvas, img[alt]');
        if (source && getComputedStyle(source).visibility !== 'hidden') {
            const isImage = source instanceof HTMLImageElement;
            const width = isImage ? source.naturalWidth : source.width;
            const height = isImage ? source.naturalHeight : source.height;
            if (width && height && (!isImage || source.complete)) {
                context.drawImage(source, width * .8, height * .8, 1, 1, 0, 0, 1, 1);
                const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
                const color = rgb.join(',');
                const key = isImage ? source.currentSrc : `${width}:${height}:${color}`;
                if (source !== previousSource || key !== previousKey) {
                    window.browserViewMeasurements.push({at:performance.now(),
                        distinct:color !== previousRGB, rgb, width, height,
                        surface:isImage ? 'jpeg' : 'canvas'});
                    previousSource = source;
                    previousKey = key;
                    previousRGB = color;
                }
            }
        }
        animation = requestAnimationFrame(sample);
    };
    window.stopBrowserViewMeasurements = () => cancelAnimationFrame(animation);
    animation = requestAnimationFrame(sample);
}"""
