/**
 * Draws a library card onto a canvas. The same drawing backs the on-screen
 * previews and the downloaded PDF, so what you see is what prints.
 */
import JsBarcode from "jsbarcode";
import jsPDF from "jspdf";
import {ICardSettings, ICustomerCard} from "@vaultisse/types/customer/ICustomerCard";

/** ID-1 (credit card) size. */
const CARD_MM = {width: 85.6, height: 53.98};

/** Layout units; the canvas is rendered at twice this (about 600 dpi). */
const WIDTH = 1011;
const HEIGHT = 638;
const SCALE = 2;

/** Everything drawn on one card. */
export interface CardContent {
	customer: Pick<ICustomerCard, "uuid" | "name" | "group_name" | "member_since" | "photo">;
	settings: ICardSettings;
	/** Localized "Member since" caption. */
	memberSinceLabel: string;
}

/** Loads a data URI; resolves null rather than failing the whole card. */
function loadImage(src: string | null): Promise<HTMLImageElement | null> {
	if (!src) {
		return Promise.resolve(null);
	}
	return new Promise((resolve) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => resolve(null);
		image.src = src;
	});
}

/** Draws an image filling the box, cropping the overflow. */
function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, w: number, h: number) {
	const ratio = Math.max(w / image.width, h / image.height);
	const sw = w / ratio;
	const sh = h / ratio;
	ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, w, h);
}

/** Writes one line, shortened with an ellipsis to fit. */
function drawLine(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, size: number, bold = false) {
	ctx.font = `${bold ? "bold " : ""}${size}px Arial, sans-serif`;
	let line = text;
	while (line.length > 1 && ctx.measureText(line).width > maxWidth) {
		line = line.slice(0, -2) + "…";
	}
	ctx.fillText(line, x, y);
}

/**
 * Renders a card.
 * @param canvas Target; resized to the card's pixel size.
 * @param content What to draw.
 */
export async function drawCustomerCard(canvas: HTMLCanvasElement, content: CardContent): Promise<void> {
	const {customer, settings} = content;
	const [background, photo] = await Promise.all([loadImage(settings.background), loadImage(customer.photo)]);

	canvas.width = WIDTH * SCALE;
	canvas.height = HEIGHT * SCALE;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return;
	}
	ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);

	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, WIDTH, HEIGHT);
	if (background) {
		drawCover(ctx, background, 0, 0, WIDTH, HEIGHT);
	} else {
		ctx.fillStyle = "#c97b3d";
		ctx.fillRect(0, 0, WIDTH, 24);
	}

	// Keeps the text readable over any background.
	ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
	ctx.fillRect(30, 50, WIDTH - 60, 360);

	// Public institutions get no photo and no placeholder: the text takes the space.
	if (settings.photos_allowed) {
		// Photo, or a plain silhouette placeholder.
		const box = {x: 50, y: 70, w: 250, h: 320};
		if (photo) {
			drawCover(ctx, photo, box.x, box.y, box.w, box.h);
		} else {
			ctx.fillStyle = "#e7ddcb";
			ctx.fillRect(box.x, box.y, box.w, box.h);
			ctx.fillStyle = "#b9ab90";
			ctx.beginPath();
			ctx.arc(box.x + box.w / 2, box.y + 120, 60, 0, Math.PI * 2);
			ctx.fill();
			// A new path, or a stray line would join the head to the shoulders.
			ctx.beginPath();
			ctx.ellipse(box.x + box.w / 2, box.y + box.h, 105, 110, 0, Math.PI, Math.PI * 2);
			ctx.fill();
		}
	}

	const x = settings.photos_allowed ? 330 : 50;
	const textWidth = WIDTH - x - 50;
	ctx.textAlign = "left";
	ctx.textBaseline = "top";
	ctx.fillStyle = "#2f2a22";
	// A long name gets smaller before it gets cut off.
	let nameSize = 52;
	ctx.font = `bold ${nameSize}px Arial, sans-serif`;
	while (nameSize > 34 && ctx.measureText(customer.name).width > textWidth) {
		ctx.font = `bold ${--nameSize}px Arial, sans-serif`;
	}
	drawLine(ctx, customer.name, x, 75, textWidth, nameSize, true);

	let y = 150;
	const row = (text: string) => {
		drawLine(ctx, text, x, y, textWidth, 32);
		y += 52;
	};
	if (customer.group_name) {
		row(customer.group_name);
	}
	const custom = [[settings.field1_label, settings.field1_value], [settings.field2_label, settings.field2_value]];
	for (const [label, value] of custom) {
		if (label || value) {
			row([label, value].filter(Boolean).join(" "));
		}
	}
	row(`${content.memberSinceLabel}: ${new Date(`${customer.member_since}T00:00:00`).toLocaleDateString()}`);

	// Barcode: the uuid without hyphens keeps the bars as wide as possible.
	// Always on solid white so scanners get their contrast and quiet zone.
	const barcode = document.createElement("canvas");
	JsBarcode(barcode, customer.uuid.replace(/-/g, ""), {format: "CODE128", displayValue: false, width: 5, height: 300, margin: 0});
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 430, WIDTH, HEIGHT - 430);
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(barcode, (WIDTH - 945) / 2, 448, 945, 135);
	ctx.fillStyle = "#000000";
	ctx.textAlign = "center";
	ctx.font = "24px monospace";
	ctx.fillText(customer.uuid, WIDTH / 2, 596);
}

/**
 * Saves a drawn card as a card-sized PDF.
 * @param canvas A canvas filled by `drawCustomerCard`.
 * @param fileName Download name, without extension.
 */
export function downloadCardPdf(canvas: HTMLCanvasElement, fileName: string) {
	const pdf = new jsPDF({orientation: "landscape", unit: "mm", format: [CARD_MM.width, CARD_MM.height]});
	pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, CARD_MM.width, CARD_MM.height);
	pdf.save(`${fileName}.pdf`);
}
