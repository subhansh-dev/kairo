/**
 * HomeAssistant tool — Home Assistant integration.
 */

export interface HAEntity {
  entityId: string;
  state: string;
  attributes: Record<string, unknown>;
  lastChanged: string;
}

/**
 * Build a Home Assistant API request.
 */
export function buildHARequest(endpoint: string, method: string = 'GET', body?: unknown): Record<string, unknown> {
  return { endpoint, method, body };
}

/**
 * Format a Home Assistant entity for display.
 */
export function formatHAEntity(entity: HAEntity): string {
  const name = entity.attributes.friendly_name || entity.entityId;
  return `${name}: ${entity.state}`;
}

/**
 * Build a service call request.
 */
export function buildHAServiceCall(domain: string, service: string, entityId: string, data?: Record<string, unknown>): Record<string, unknown> {
  return {
    endpoint: `/api/services/${domain}/${service}`,
    method: 'POST',
    body: { entity_id: entityId, ...data },
  };
}
