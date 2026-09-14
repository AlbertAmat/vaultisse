export interface ImportError {
    row: number;
    title?: string;
    reason: string;
}

export interface ImportResult {
    imported: number;
    skipped: number;
    failed: number;
    errors: ImportError[];
}
