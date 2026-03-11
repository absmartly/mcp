import { ABsmartlyResponse, ListExperimentsParams } from './types';
import { debug } from './config';
import { MCP_VERSION } from './version';

const DEFAULT_ABSMARTLY_API_ENDPOINT = "https://sandbox.absmartly.com";

export class ABsmartlyAPIClient {
  private authToken: string;
  private authType: 'jwt' | 'api-key';
  private baseUrl: string;
  constructor(authToken: string, baseUrl: string = DEFAULT_ABSMARTLY_API_ENDPOINT, authType?: 'jwt' | 'api-key') {
    baseUrl = baseUrl.replace(/\/$/, '');
    if (baseUrl.endsWith('/v1')) {
      baseUrl = baseUrl.substring(0, baseUrl.length - 3);
    }
    debug('🔧 ABsmartlyAPIClient constructor:', {
      tokenLength: authToken?.length,
      tokenPreview: authToken?.substring(0, 20) + '...',
      baseUrl,
      authType
    });
    this.authToken = authToken;
    this.baseUrl = baseUrl;
    if (authType) {
      this.authType = authType;
      debug('🔧 Using provided auth type:', authType);
    } else {
      this.authType = authToken.includes('.') && authToken.split('.').length === 3 ? 'jwt' : 'api-key';
      debug('🔧 Auto-detected auth type:', this.authType);
    }
    if (this.authType === 'jwt') {
      try {
        const parts = authToken.split('.');
        debug('🔍 JWT analysis:', {
          parts: parts.length,
          header: parts[0]?.substring(0, 20) + '...',
          payload: parts[1]?.substring(0, 20) + '...',
          signature: parts[2]?.substring(0, 20) + '...'
        });
        if (parts.length === 3) {
          const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
          const payload = JSON.parse(atob(base64));
          debug('🔍 JWT payload keys:', Object.keys(payload));
          debug('🔍 JWT payload preview:', {
            iss: payload.iss,
            sub: payload.sub,
            aud: payload.aud,
            exp: payload.exp,
            iat: payload.iat,
            token: payload.token ? 'present' : 'missing',
            email: payload.email,
            hasTokenField: 'token' in payload
          });
        }
      } catch (jwtError) {
        console.error('❌ Failed to analyze JWT:', (jwtError as Error).message);
      }
    }
  }
  get apiEndpoint(): string {
    return this.baseUrl;
  }
  private listEntity(path: string, params?: Record<string, unknown>): Promise<ABsmartlyResponse> {
    const searchParams = new URLSearchParams();
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          searchParams.append(key, value.toString());
        }
      }
    }
    const query = searchParams.toString();
    return this.makeRequest(`${path}${query ? `?${query}` : ''}`);
  }
  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ABsmartlyResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    const authHeader = this.authType === 'jwt' ? `JWT ${this.authToken}` : `Api-Key ${this.authToken}`;
    const headers = {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'User-Agent': `ABsmartly-MCP-Server/${MCP_VERSION}`,
      ...options.headers,
    };
    debug(`🔗 ABsmartly API Request: [Auth: ${this.authType === 'jwt' ? 'JWT' : 'Api-Key'}] ${options.method || 'GET'} ${url}`);
    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });
      let data: any;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const text = await response.text();
        debug('📄 Non-JSON response:', {
          status: response.status,
          statusText: response.statusText,
          contentType,
          bodyPreview: text.slice(0, 500)
        });
        data = { message: text };
      }
      if (response.ok) {
        debug(`📡 ABsmartly API Response: ${response.status} ${response.ok ? 'OK' : 'ERROR'} ${url} ${JSON.stringify(data).slice(0, 200)}`);
      } else {
        const errorMessage = data.errors ? data.errors.join(', ') : data.error || response.statusText;
        debug(`❌ ABsmartly API Error: ${response.status} ${url} "${errorMessage}" - ${JSON.stringify(data).slice(0, 200)}`);
      }
      if (!response.ok) {
        const errorDetails = {
          status: response.status,
          statusText: response.statusText,
          url: url,
          method: options.method || 'GET',
          responseData: data
        };
        return {
          ok: false,
          errors: data.errors || data.error || [`HTTP ${response.status}: ${response.statusText}`],
          details: errorDetails
        };
      }
      return {
        ok: true,
        data,
      };
    } catch (error) {
      debug('💥 ABsmartly API Error:', error);
      return {
        ok: false,
        errors: [`Network error: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }
  async listExperiments(params?: ListExperimentsParams): Promise<ABsmartlyResponse> {
    return this.listEntity('/v1/experiments', params as Record<string, unknown>);
  }
  async getExperiment(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/experiments/${id}`);
  }
  async createExperiment(data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest('/v1/experiments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
  async updateExperiment(id: number, data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/experiments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }
  async startExperiment(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/experiments/${id}/start`, {
      method: 'PUT',
    });
  }
  async stopExperiment(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/experiments/${id}/stop`, {
      method: 'PUT',
    });
  }
  async restartExperiment(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/experiments/${id}/restart`, {
      method: 'PUT',
    });
  }
  async setExperimentFullOn(id: number, data?: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/experiments/${id}/full_on`, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }
  async setExperimentToDevelopment(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/experiments/${id}/development`, {
      method: 'PUT',
    });
  }
  async listGoals(params?: any): Promise<ABsmartlyResponse> {
    return this.listEntity('/v1/goals', params);
  }
  async getGoal(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/goals/${id}`);
  }
  async createGoal(data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest('/v1/goals', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
  async updateGoal(id: number, data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/goals/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }
  async listMetrics(params?: any): Promise<ABsmartlyResponse> {
    return this.listEntity('/v1/metrics', params);
  }
  async getMetric(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/metrics/${id}`);
  }
  async createMetric(data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest('/v1/metrics', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
  async updateMetric(id: number, data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/metrics/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }
  async listUsers(params?: any): Promise<ABsmartlyResponse> {
    return this.listEntity('/v1/users', params);
  }
  async getUser(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/users/${id}`);
  }
  async getCurrentUser(): Promise<ABsmartlyResponse> {
    return this.makeRequest('/auth/current-user');
  }
  async createUser(data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest('/v1/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
  async updateUser(id: number, data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }
  async listTeams(params?: any): Promise<ABsmartlyResponse> {
    return this.listEntity('/v1/teams', params);
  }
  async getTeam(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/teams/${id}`);
  }
  async createTeam(data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest('/v1/teams', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
  async updateTeam(id: number, data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/teams/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }
  async getExperimentMetrics(experimentId: number, metricId: number, params?: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/experiments/${experimentId}/metrics/${metricId}`, {
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  }
  async getExperimentMetricHistory(experimentId: number, metricId: number, params?: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/experiments/${experimentId}/metrics/${metricId}/history`, {
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  }
  async getExperimentParticipants(experimentId: number, params?: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/experiments/${experimentId}/participants/history`, {
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  }
  async getExperimentActivity(experimentId: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/experiments/${experimentId}/activity`);
  }
  async addExperimentActivity(experimentId: number, data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/experiments/${experimentId}/activity`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
  async archiveExperiment(experimentId: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/experiments/${experimentId}/archive`, {
      method: 'PUT',
    });
  }
  async setExperimentDevelopment(experimentId: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/experiments/${experimentId}/development`, {
      method: 'PUT',
    });
  }
  async listApplications(params?: any): Promise<ABsmartlyResponse> {
    return this.listEntity('/v1/applications', params);
  }
  async getApplication(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/applications/${id}`);
  }
  async createApplication(data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest('/v1/applications', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
  async updateApplication(id: number, data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/applications/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }
  async listUnitTypes(params?: any): Promise<ABsmartlyResponse> {
    return this.listEntity('/v1/unit_types', params);
  }
  async getUnitType(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/unit_types/${id}`);
  }
  async createUnitType(data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest('/v1/unit_types', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
  async updateUnitType(id: number, data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/unit_types/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }
  async listEnvironments(params?: any): Promise<ABsmartlyResponse> {
    return this.listEntity('/v1/environments', params);
  }
  async getEnvironment(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/environments/${id}`);
  }
  async getInsightsSummary(params?: any): Promise<ABsmartlyResponse> {
    return this.listEntity('/v1/insights/summary', params);
  }
  async getInsightsVelocity(params?: any): Promise<ABsmartlyResponse> {
    return this.listEntity('/v1/insights/velocity/widgets', params);
  }
  async getInsightsDecisions(params?: any): Promise<ABsmartlyResponse> {
    return this.listEntity('/v1/insights/decisions/widgets', params);
  }
  async getInsightsDecisionHistory(params?: any): Promise<ABsmartlyResponse> {
    return this.listEntity('/v1/insights/decisions/history', params);
  }
  async listSegments(params?: any): Promise<ABsmartlyResponse> {
    return this.listEntity('/v1/segments', params);
  }
  async getSegment(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/segments/${id}`);
  }
  async createSegment(data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest('/v1/segments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
  async updateSegment(id: number, data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/segments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }
  async listExperimentCustomSectionFields(params?: any): Promise<ABsmartlyResponse> {
    return this.listEntity('/v1/experiment_custom_section_fields', params);
  }
  async getExperimentCustomSectionField(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/experiment_custom_section_fields/${id}`);
  }
  async uploadVariantScreenshot(data: {
    data: string;
    file_name: string;
    file_size: number;
    content_type: string;
    width: number;
    height: number;
    crop_left?: number;
    crop_top?: number;
    crop_width?: number;
    crop_height?: number;
  }): Promise<ABsmartlyResponse> {
    const payload = {
      usage: "variant_screenshots",
      file: {
        data: data.data,
        file_name: data.file_name,
        file_size: data.file_size,
        content_type: data.content_type,
        width: data.width,
        height: data.height,
        crop_left: data.crop_left || 0,
        crop_top: data.crop_top || 0,
        crop_width: data.crop_width || data.width,
        crop_height: data.crop_height || data.height
      }
    };
    return this.makeRequest('/v1/file_uploads/variant_screenshots', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
  async listExperimentTags(params?: any): Promise<ABsmartlyResponse> {
    return this.listEntity('/v1/experiment_tags', params);
  }
  async getExperimentTag(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/experiment_tags/${id}`);
  }
  async createExperimentTag(data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest('/v1/experiment_tags', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
  async updateExperimentTag(id: number, data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/v1/experiment_tags/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }
  async request(endpoint: string, options: RequestInit = {}): Promise<ABsmartlyResponse> {
    return this.makeRequest(endpoint, options);
  }
}
