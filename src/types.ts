export type Platform = "apple" | "google";

export interface Customer {
  id: string;
  email: string | null;
  phone: string | null;
  created_at: Date;
  consent_at: Date;
  deleted_at: Date | null;
  stamps_count: number;
  reward_ready: boolean;
  last_stamp_at: Date | null;
}

export interface Pass {
  id: string;
  customer_id: string;
  platform: Platform;
  serial_number: string;
  auth_token: string;
  last_updated_at: Date;
  created_at: Date;
}

export interface Staff {
  id: string;
  email: string;
  magic_link_hash: string | null;
  magic_link_exp: Date | null;
  session_hash: string | null;
  session_exp: Date | null;
  last_login_at: Date | null;
}

// Token payloads used throughout the app.
export interface PassQrPayload {
  sub: string;           // customer id
  typ: "stamp";          // single action type — redeem uses same stamp flow at N
  iat: number;
  exp: number;
}

export interface StaffSessionPayload {
  sub: string;           // staff id
  iat: number;
  exp: number;
}

export interface GdprPayload {
  sub: string;           // customer id
  typ: "gdpr";
  iat: number;
}
