export interface UserProfile {
    code: string;
    name: string;
    email: string;
    language: string;
    region: string;
    /** `data:image/png;base64,...` if the user has one uploaded, else null. */
    image: string | null;
    theme: string;
    sidebarRail: boolean;
    leasingEnabled: boolean;
    isPublicInstitution: boolean;
    totpEnabled: boolean;
    securityNoticeAccepted: boolean;
    termsOfServiceAccepted: boolean;
    activeVault: number;
}

export interface ProfileUpdateFields {
    name: string;
    email: string;
    language: string;
    region: string;
}

export interface UserSession {
    id: number;
    userAgent: string | null;
    ipAddress: string | null;
    createdDate: string;
    lastSeenDate: string;
}

export interface ActivityLogEntry {
    id: number;
    action: string;
    metadata: Record<string, unknown>;
    createdDate: string;
}

export interface TwoFactorSetup {
    secret: string;
    qrCodeDataUrl: string;
}
