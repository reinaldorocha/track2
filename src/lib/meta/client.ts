import axios from 'axios'

const BASE = 'https://graph.facebook.com/v21.0'

export type MetaAction = { action_type: string; value: string }
export type MetaAdAccount = { id: string; name: string; account_id?: string; currency?: string; timezone_name?: string; account_status?: number; amount_spent?: string; business_name?: string }
export type MetaCampaign = { id: string; name: string; status?: string; objective?: string; buying_type?: string; daily_budget?: string; lifetime_budget?: string; start_time?: string; stop_time?: string }
export type MetaAdSet = { id: string; name: string; status?: string; daily_budget?: string; lifetime_budget?: string; optimization_goal?: string; attribution_spec?: unknown; billing_event?: string; bid_amount?: string; start_time?: string; end_time?: string }
export type MetaAd = { id: string; name: string; status?: string; creative?: { id?: string; image_url?: string; thumbnail_url?: string } }
export type MetaInsight = { campaign_id?: string; adset_id?: string; ad_id?: string; date_start: string; date_stop: string; spend?: string; impressions?: string; reach?: string; clicks?: string; unique_clicks?: string; ctr?: string; cpc?: string; cpm?: string; frequency?: string; actions?: MetaAction[]; action_values?: MetaAction[] }

export class MetaApiError extends Error {
  public code?: number
  public subcode?: number
  public isTokenInvalid: boolean
  public isRateLimit: boolean

  constructor(message: string, code?: number, subcode?: number) {
    super(message)
    this.name = 'MetaApiError'
    this.code = code
    this.subcode = subcode
    // Meta Error 190 = Invalid OAuth 2.0 Access Token / Expired / Deauthorized
    this.isTokenInvalid = code === 190 || code === 102 || code === 10
    // Meta Error 17 = User request limit reached, 32 = Page request limit, 613 = Custom rate limit
    this.isRateLimit = code === 17 || code === 32 || code === 613
  }
}

export class MetaApiClient {
  constructor(private accessToken: string) {}
  
  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    try {
      const response = await axios.get(`${BASE}${path}`, {
        params: { ...params, access_token: this.accessToken },
        timeout: 20000,
      })
      return response.data
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const errorData = err.response?.data?.error
        if (errorData) {
          throw new MetaApiError(
            errorData.message || 'Erro na Meta Graph API',
            errorData.code,
            errorData.error_subcode
          )
        }
        throw new MetaApiError(`Falha HTTP na Meta Graph API (${err.response?.status || 'sem resposta'})`)
      }
      throw err
    }
  }

  private async getAll<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const rows: T[] = []
    let after: string | undefined
    const seen = new Set<string>()
    do {
      const page = await this.get<{ data?: T[]; paging?: { cursors?: { after?: string }; next?: string } }>(path, {
        ...params,
        ...(after ? { after } : {}),
      })
      rows.push(...(page.data || []))
      if (page.paging?.next && !page.paging.cursors?.after) throw new Error('Meta retornou próxima página sem cursor')
      const next = page.paging?.next ? page.paging?.cursors?.after : undefined
      if (next && seen.has(next)) throw new Error('Paginação da Meta repetiu o cursor')
      if (next) seen.add(next)
      after = next
    } while (after)
    return rows
  }
  
  async getMe() { 
    return this.get<{ id: string; name: string; email?: string }>('/me', {
      fields: 'id,name,email',
    }) 
  }
  
  async getAdAccounts() {
    return this.getAll<MetaAdAccount>('/me/adaccounts', {
      fields: 'id,name,account_id,currency,timezone_name,account_status,amount_spent,business_name',
      limit: '100',
    })
  }
  
  async getCampaigns(adAccountId: string) {
    const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`
    return this.getAll<MetaCampaign>(`/${accountId}/campaigns`, {
      fields: 'id,name,status,objective,buying_type,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time',
      limit: '500',
    })
  }
  
  async getAdSets(campaignId: string) {
    return this.getAll<MetaAdSet>(`/${campaignId}/adsets`, {
      fields: 'id,name,status,daily_budget,lifetime_budget,optimization_goal,attribution_spec,billing_event,bid_amount,start_time,end_time,created_time,updated_time',
      limit: '500',
    })
  }
  
  async getAds(adSetId: string) {
    return this.getAll<MetaAd>(`/${adSetId}/ads`, {
      fields: 'id,name,status,creative{id,name,title,body,image_url,thumbnail_url},created_time,updated_time',
      limit: '500',
    })
  }
  
  async getInsights(
    adAccountId: string,
    level: 'campaign' | 'adset' | 'ad',
    datePreset: string = 'last_30d',
    since?: string,
    until?: string
  ) {
    const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`
    const params: Record<string, string> = {
      fields: 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,clicks,unique_clicks,ctr,cpc,cpm,frequency,actions,action_values,conversions,conversion_values,date_start,date_stop',
      level,
      time_increment: '1',
      limit: '500',
      use_unified_attribution_setting: 'true',
    }

    if (since && until) { 
      params.time_range = JSON.stringify({ since, until }) 
    } else { 
      params.date_preset = datePreset 
    }
    
    return this.getAll<MetaInsight>(`/${accountId}/insights`, params)
  }

  async post<T>(path: string, data: Record<string, unknown> = {}, params: Record<string, string> = {}): Promise<T> {
    try {
      const response = await axios.post(`${BASE}${path}`, data, {
        params: { ...params, access_token: this.accessToken },
        timeout: 20000,
      })
      return response.data
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const errorData = err.response?.data?.error
        if (errorData) {
          throw new MetaApiError(
            errorData.message || 'Erro na Meta Graph API',
            errorData.code,
            errorData.error_subcode
          )
        }
        throw new MetaApiError(`Falha HTTP na Meta Graph API (${err.response?.status || 'sem resposta'})`)
      }
      throw err
    }
  }

  async updateCampaign(
    campaignId: string,
    data: { status?: string; name?: string; daily_budget?: number; lifetime_budget?: number }
  ) {
    const id = campaignId.replace(/^act_/, '')
    return this.post<{ success: boolean }>(`/${id}`, data)
  }

  async updateAdSet(
    adSetId: string,
    data: { status?: string; name?: string; daily_budget?: number; lifetime_budget?: number }
  ) {
    const id = adSetId.replace(/^act_/, '')
    return this.post<{ success: boolean }>(`/${id}`, data)
  }

  async updateAd(
    adId: string,
    data: { status?: string; name?: string }
  ) {
    const id = adId.replace(/^act_/, '')
    return this.post<{ success: boolean }>(`/${id}`, data)
  }

  async duplicateCampaign(
    campaignId: string,
    options: { deepCopy?: boolean; status?: string; suffix?: string } = {}
  ) {
    const id = campaignId.replace(/^act_/, '')
    const deepCopy = options.deepCopy !== false
    const statusOption = options.status || 'PAUSED'
    return this.post<{ id?: string; copied_parent_id?: string; success?: boolean }>(`/${id}/copies`, {
      deep_copy: deepCopy,
      status_option: statusOption,
      ...(options.suffix ? { rename_options: { suffix: options.suffix } } : {}),
    })
  }

  async duplicateAdSet(
    adSetId: string,
    options: { deepCopy?: boolean; status?: string; suffix?: string } = {}
  ) {
    const id = adSetId.replace(/^act_/, '')
    const deepCopy = options.deepCopy !== false
    const statusOption = options.status || 'PAUSED'
    return this.post<{ id?: string; copied_parent_id?: string; success?: boolean }>(`/${id}/copies`, {
      deep_copy: deepCopy,
      status_option: statusOption,
      ...(options.suffix ? { rename_options: { suffix: options.suffix } } : {}),
    })
  }

  async duplicateAd(
    adId: string,
    options: { status?: string; suffix?: string } = {}
  ) {
    const id = adId.replace(/^act_/, '')
    const statusOption = options.status || 'PAUSED'
    return this.post<{ id?: string; copied_parent_id?: string; success?: boolean }>(`/${id}/copies`, {
      status_option: statusOption,
      ...(options.suffix ? { rename_options: { suffix: options.suffix } } : {}),
    })
  }
}

