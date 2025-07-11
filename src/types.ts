// Environment interface for Cloudflare Worker
export interface Env {
  MCP_OBJECT: DurableObjectNamespace;
  OAUTH_KV: KVNamespace;
  
  // OAuth Configuration (ABsmartly OAuth Provider)
  OAUTH_CLIENT_ID?: string;
  OAUTH_CLIENT_SECRET?: string;
  OAUTH_AUTHORIZATION_URL?: string;
  OAUTH_TOKEN_URL?: string;
  OAUTH_USERINFO_URL?: string;
  
  // ABsmartly OAuth Configuration
  ABSMARTLY_OAUTH_CLIENT_ID?: string;
  ABSMARTLY_OAUTH_CLIENT_SECRET?: string;
  
  // Legacy Cloudflare Access Configuration (for backwards compatibility)
  ACCESS_CLIENT_ID?: string;
  ACCESS_CLIENT_SECRET?: string;
  ACCESS_TOKEN_URL?: string;
  ACCESS_AUTHORIZATION_URL?: string;
  ACCESS_JWKS_URL?: string;
  COOKIE_ENCRYPTION_KEY?: string;
  
  // Email allowlist for both OAuth methods
  ALLOWED_EMAILS?: string;
  
  // Default ABsmartly Configuration
  DEFAULT_ABSMARTLY_API_KEY?: string;
  DEFAULT_ABSMARTLY_ENDPOINT?: string;
}

// State interface for Durable Objects sessions
export interface ABsmartlyState {
  sessionId?: string;
  apiEndpoint: string;
  apiKey: string | null;
  configured: boolean;
  lastActivity?: number;
  cache?: Record<string, {
    data: any;
    timestamp: number;
    ttl: number;
  }>;
}

// Initial state when creating new sessions
export interface InitialState {
  apiEndpoint: string;
}

// ABsmartly API response wrapper
export interface ABsmartlyResponse<T = any> {
  ok: boolean;
  data?: T;
  errors?: string[];
  details?: any;
  status?: number;
  statusText?: string;
}

// Common ABsmartly entity interfaces
export interface Experiment {
  id: number;
  name: string;
  description?: string;
  state: 'draft' | 'development' | 'running' | 'stopped' | 'archived';
  created_at: string;
  updated_at: string;
  created_by_user_id: number;
  updated_by_user_id?: number;
}

export interface Goal {
  id: number;
  name: string;
  description?: string;
  type: string;
  created_at: string;
  updated_at: string;
}

export interface Metric {
  id: number;
  name: string;
  description?: string;
  type: string;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  created_at: string;
  updated_at: string;
}

export interface Team {
  id: number;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

// List experiments filter parameters - Complete from OpenAPI spec
export interface ListExperimentsParams {
  // Basic query parameters
  search?: string;
  sort?: string;
  page?: number;
  items?: number;
  
  // Filter by experiment attributes (comma-separated lists)
  state?: string; // 'created,ready,running,development,full_on,running_not_full_on,stopped,archived,scheduled'
  significance?: string; // 'positive,negative,neutral,inconclusive'
  owners?: string; // '3,5,7'
  teams?: string; // '1,2,3'
  tags?: string; // '2,4,6'
  templates?: string; // '238,240'
  applications?: string; // '39,3'
  unit_types?: string; // '42,75'
  
  // Range filters (comma-separated min,max)
  impact?: string; // '1,5'
  created_at?: string; // '1740873600000,1742515199999' (timestamp range)
  updated_at?: string; // '1742083200000,1742515199999' (timestamp range)
  full_on_at?: string; // '1740873600000,1743292799999' (timestamp range)
  
  // Boolean filters (0 or 1)
  sample_ratio_mismatch?: 0 | 1;
  cleanup_needed?: 0 | 1;
  audience_mismatch?: 0 | 1;
  sample_size_reached?: 0 | 1;
  experiments_interact?: 0 | 1;
  group_sequential_updated?: 0 | 1;
  assignment_conflict?: 0 | 1;
  metric_threshold_reached?: 0 | 1;
  previews?: 0 | 1;
  
  // String filters
  analysis_type?: string; // 'group_sequential,fixed_horizon'
  type?: string; // 'test' or 'feature'
  
  // Number filters
  iterations?: number;
}