import { ABsmartlyResponse, ListExperimentsParams } from './types';

export class ABsmartlyAPIClient {
  private authToken: string;
  private authType: 'jwt' | 'api-key';
  private baseUrl: string;

  constructor(authToken: string, baseUrl: string = 'https://sandbox.absmartly.com/v1', authType?: 'jwt' | 'api-key') {
    // Ensure baseUrl ends with /v1 if it doesn't already
    if (!baseUrl.endsWith('/v1')) {
      baseUrl = baseUrl.replace(/\/$/, '') + '/v1';
    }
    
    console.log('🔧 ABsmartlyAPIClient constructor:', {
      tokenLength: authToken?.length,
      tokenPreview: authToken?.substring(0, 20) + '...',
      baseUrl,
      authType
    });
    
    this.authToken = authToken;
    this.baseUrl = baseUrl;
    
    // Auto-detect auth type if not specified
    if (authType) {
      this.authType = authType;
      console.log('🔧 Using provided auth type:', authType);
    } else {
      // JWT tokens have 3 parts separated by dots
      this.authType = authToken.includes('.') && authToken.split('.').length === 3 ? 'jwt' : 'api-key';
      console.log('🔧 Auto-detected auth type:', this.authType);
    }
    
    // If JWT, try to decode and inspect
    if (this.authType === 'jwt') {
      try {
        const parts = authToken.split('.');
        console.log('🔍 JWT analysis:', {
          parts: parts.length,
          header: parts[0]?.substring(0, 20) + '...',
          payload: parts[1]?.substring(0, 20) + '...',
          signature: parts[2]?.substring(0, 20) + '...'
        });
        
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]));
          console.log('🔍 JWT payload keys:', Object.keys(payload));
          console.log('🔍 JWT payload preview:', {
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

  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ABsmartlyResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    
    // Use appropriate authentication header based on token type
    const authHeader = this.authType === 'jwt' ? `JWT ${this.authToken}` : `Api-Key ${this.authToken}`;
    
    const headers = {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'User-Agent': 'ABsmartly-MCP-Server/1.0.0',
      ...options.headers,
    };

    console.log(`🔗 ABsmartly API Request: [Auth: ${this.authType === 'jwt' ? 'JWT' : 'Api-Key'}] ${options.method || 'GET'} ${url}`);

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
        console.log('📄 Non-JSON response:', {
          status: response.status,
          statusText: response.statusText,
          contentType,
          bodyPreview: text.slice(0, 500)
        });
        data = { message: text };
      }

      if (response.ok) {
        console.log(`📡 ABsmartly API Response: ${response.status} ${response.ok ? 'OK' : 'ERROR'} ${url} ${JSON.stringify(data).slice(0, 200)}`);
      } else {
        console.error(`❌ ABsmartly API Error: ${response.status} ${url} "${response.errors.join(', ')}" - ${JSON.stringify(data).slice(0, 200)}`);
      }

      if (!response.ok) {
        // Enhanced error details for debugging
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
      console.error('💥 ABsmartly API Error:', error);
      return {
        ok: false,
        errors: [`Network error: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  // Experiments API
  async listExperiments(params?: ListExperimentsParams): Promise<ABsmartlyResponse> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          // All values are already strings or can be converted to strings
          searchParams.append(key, value.toString());
        }
      });
    }
    
    const endpoint = `/experiments${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    return this.makeRequest(endpoint);
  }

  async getExperiment(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/experiments/${id}`);
  }

  async createExperiment(data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest('/experiments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateExperiment(id: number, data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/experiments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async startExperiment(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/experiments/${id}/start`, {
      method: 'PUT',
    });
  }

  async stopExperiment(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/experiments/${id}/stop`, {
      method: 'PUT',
    });
  }

  async restartExperiment(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/experiments/${id}/restart`, {
      method: 'PUT',
    });
  }

  async setExperimentFullOn(id: number, data?: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/experiments/${id}/full_on`, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async setExperimentToDevelopment(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/experiments/${id}/development`, {
      method: 'PUT',
    });
  }

  // Goals API
  async listGoals(): Promise<ABsmartlyResponse> {
    return this.makeRequest('/goals');
  }

  async getGoal(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/goals/${id}`);
  }

  async createGoal(data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest('/goals', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateGoal(id: number, data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/goals/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Metrics API
  async listMetrics(params?: any): Promise<ABsmartlyResponse> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, value.toString());
        }
      });
    }
    const endpoint = `/metrics${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    return this.makeRequest(endpoint);
  }

  async getMetric(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/metrics/${id}`);
  }

  async createMetric(data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest('/metrics', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateMetric(id: number, data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/metrics/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Users API
  async listUsers(): Promise<ABsmartlyResponse> {
    return this.makeRequest('/users');
  }

  async getUser(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/users/${id}`);
  }

  async createUser(data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest('/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateUser(id: number, data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Teams API
  async listTeams(): Promise<ABsmartlyResponse> {
    return this.makeRequest('/teams');
  }

  async getTeam(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/teams/${id}`);
  }

  async createTeam(data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest('/teams', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateTeam(id: number, data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/teams/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Experiment Analytics API
  async getExperimentMetrics(experimentId: number, metricId: number, params?: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/experiments/${experimentId}/metrics/${metricId}`, {
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  }

  async getExperimentMetricHistory(experimentId: number, metricId: number, params?: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/experiments/${experimentId}/metrics/${metricId}/history`, {
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  }

  async getExperimentParticipants(experimentId: number, params?: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/experiments/${experimentId}/participants/history`, {
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  }

  async getExperimentActivity(experimentId: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/experiments/${experimentId}/activity`);
  }

  async addExperimentActivity(experimentId: number, data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/experiments/${experimentId}/activity`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Experiment Management API
  async archiveExperiment(experimentId: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/experiments/${experimentId}/archive`, {
      method: 'PUT',
    });
  }

  async setExperimentDevelopment(experimentId: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/experiments/${experimentId}/development`, {
      method: 'PUT',
    });
  }

  // Applications API
  async listApplications(params?: any): Promise<ABsmartlyResponse> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, value.toString());
        }
      });
    }
    const endpoint = `/applications${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    return this.makeRequest(endpoint);
  }

  async getApplication(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/applications/${id}`);
  }

  async createApplication(data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest('/applications', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateApplication(id: number, data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/applications/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Unit Types API
  async listUnitTypes(params?: any): Promise<ABsmartlyResponse> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, value.toString());
        }
      });
    }
    const endpoint = `/unit_types${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    return this.makeRequest(endpoint);
  }

  async getUnitType(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/unit_types/${id}`);
  }

  async createUnitType(data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest('/unit_types', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateUnitType(id: number, data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/unit_types/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Environments API  
  async listEnvironments(params?: any): Promise<ABsmartlyResponse> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, value.toString());
        }
      });
    }
    const endpoint = `/environments${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    return this.makeRequest(endpoint);
  }

  async getEnvironment(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/environments/${id}`);
  }

  // Insights API
  async getInsightsSummary(params?: any): Promise<ABsmartlyResponse> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, value.toString());
        }
      });
    }
    const endpoint = `/insights/summary${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    return this.makeRequest(endpoint);
  }

  async getInsightsVelocity(params?: any): Promise<ABsmartlyResponse> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, value.toString());
        }
      });
    }
    const endpoint = `/insights/velocity/widgets${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    return this.makeRequest(endpoint);
  }

  async getInsightsDecisions(params?: any): Promise<ABsmartlyResponse> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, value.toString());
        }
      });
    }
    const endpoint = `/insights/decisions/widgets${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    return this.makeRequest(endpoint);
  }

  async getInsightsDecisionHistory(params?: any): Promise<ABsmartlyResponse> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, value.toString());
        }
      });
    }
    const endpoint = `/insights/decisions/history${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    return this.makeRequest(endpoint);
  }

  // Segments API
  async listSegments(params?: any): Promise<ABsmartlyResponse> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, value.toString());
        }
      });
    }
    const endpoint = `/segments${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    return this.makeRequest(endpoint);
  }

  async getSegment(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/segments/${id}`);
  }

  async createSegment(data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest('/segments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSegment(id: number, data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/segments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Experiment Custom Section Fields API
  async listExperimentCustomSectionFields(params?: any): Promise<ABsmartlyResponse> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, value.toString());
        }
      });
    }
    const endpoint = `/experiment_custom_section_fields${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    return this.makeRequest(endpoint);
  }

  async getExperimentCustomSectionField(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/experiment_custom_section_fields/${id}`);
  }

  // File Upload API for variant screenshots
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

    return this.makeRequest('/file_uploads/variant_screenshots', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Experiment Tags API
  async listExperimentTags(params?: any): Promise<ABsmartlyResponse> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, value.toString());
        }
      });
    }
    const endpoint = `/experiment_tags${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    return this.makeRequest(endpoint);
  }

  async getExperimentTag(id: number): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/experiment_tags/${id}`);
  }

  async createExperimentTag(data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest('/experiment_tags', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateExperimentTag(id: number, data: any): Promise<ABsmartlyResponse> {
    return this.makeRequest(`/experiment_tags/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Generic API method for any endpoint
  async request(endpoint: string, options: RequestInit = {}): Promise<ABsmartlyResponse> {
    return this.makeRequest(endpoint, options);
  }
}