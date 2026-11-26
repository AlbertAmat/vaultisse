/**
 * Reads a picked file as a data URI, for previewing it before upload.
 * @param file The file.
 * @returns Its data URI.
 */
export function readAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}
