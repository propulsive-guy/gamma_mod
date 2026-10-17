'use client';

const MAX_FUNCTION_UPLOAD_BYTES = 3.4 * 1024 * 1024;
const MAX_SOURCE_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2600;

function loadHtmlImage(file: File): Promise<{ image: HTMLImageElement; release: () => void }> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => resolve({ image, release: () => URL.revokeObjectURL(url) });
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('This image format could not be prepared in your browser. Choose a JPG or PNG photo.'));
        };
        image.src = url;
    });
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The photo could not be optimized. Please choose another image.')), 'image/jpeg', quality);
    });
}

/** Preserve original quality for small photos; downsize/compress oversized photos
 * before they reach a Vercel Function's 4.5 MB request-body ceiling. */
export async function prepareScanImage(file: File): Promise<File> {
    if (file.size <= MAX_FUNCTION_UPLOAD_BYTES) return file;
    if (file.size > MAX_SOURCE_IMAGE_BYTES) {
        throw new Error('This photo is unusually large. Crop it to the bill or take a screenshot, then try again.');
    }

    let source: CanvasImageSource;
    let sourceWidth: number;
    let sourceHeight: number;
    let release = () => {};
    let bitmap: ImageBitmap | undefined;
    try {
        if (typeof createImageBitmap === 'function') {
            try {
                bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
            } catch {
                // Some mobile browsers cannot decode HEIC/WebP using createImageBitmap.
            }
        }
        if (bitmap) {
            source = bitmap;
            sourceWidth = bitmap.width;
            sourceHeight = bitmap.height;
        } else {
            const loaded = await loadHtmlImage(file);
            source = loaded.image;
            sourceWidth = loaded.image.naturalWidth;
            sourceHeight = loaded.image.naturalHeight;
            release = loaded.release;
        }

        if (!sourceWidth || !sourceHeight) throw new Error('The selected photo has no readable image data.');
        const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(sourceWidth, sourceHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sourceWidth * scale));
        canvas.height = Math.max(1, Math.round(sourceHeight * scale));
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Your browser could not prepare this photo. Please try another browser.');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(source, 0, 0, canvas.width, canvas.height);

        let blob: Blob | undefined;
        for (const quality of [0.94, 0.9, 0.86, 0.82, 0.78, 0.74]) {
            blob = await canvasToJpeg(canvas, quality);
            if (blob.size <= MAX_FUNCTION_UPLOAD_BYTES) break;
        }
        if (!blob || blob.size > MAX_FUNCTION_UPLOAD_BYTES) {
            throw new Error('This bill photo could not be reduced enough for upload. Crop closer to the bill and try again.');
        }
        const safeName = file.name.replace(/\.[^.]+$/, '') || 'bill-photo';
        return new File([blob], `${safeName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
    } finally {
        bitmap?.close();
        release();
    }
}
