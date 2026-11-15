import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { BrokerProvider } from '../shared/broker.ts';
import type { BrokerCredentials } from './contracts.ts';

export interface ServerConfig {
  provider: BrokerProvider | 'demo'; credentials: BrokerCredentials; missing: string[];
  port: number; dataDirectory: string; accountScope: string; allowedOrigins: string[];
}

/** Keep credentials on the local API server; paper hosts are fixed in index.ts. */
export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const provider = env.BROKER_PROVIDER || 'demo';
  if (!['demo', 'kis', 'kiwoom'].includes(provider)) throw new Error('BROKER_PROVIDER must be demo, kis or kiwoom.');
  if (env.BROKER_ENV && env.BROKER_ENV !== 'paper') throw new Error('This prototype implements the paper-trading API environment.');
  const prefix = provider.toUpperCase();
  const required = provider === 'demo' ? [] : [`${prefix}_APP_KEY`, `${prefix}_APP_SECRET`, ...(provider === 'kis' ? ['KIS_ACCOUNT_NUMBER', 'KIS_ACCOUNT_PRODUCT'] : [])];
  const missing = required.filter(key => !env[key]?.trim());
  const credentials: BrokerCredentials = {
    appKey: env[`${prefix}_APP_KEY`]?.trim() || '', appSecret: env[`${prefix}_APP_SECRET`]?.trim() || '',
    accountNumber: env.KIS_ACCOUNT_NUMBER?.trim(), accountProduct: env.KIS_ACCOUNT_PRODUCT?.trim(),
  };
  if (provider === 'kis' && credentials.accountNumber && !/^\d{8}$/.test(credentials.accountNumber)) throw new Error('KIS_ACCOUNT_NUMBER must contain eight digits.');
  if (provider === 'kis' && credentials.accountProduct && !/^\d{2}$/.test(credentials.accountProduct)) throw new Error('KIS_ACCOUNT_PRODUCT must contain two digits.');
  const port = Number(env.API_PORT || 4176);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid API_PORT.');
  const identity = provider === 'kis' ? [credentials.accountNumber, credentials.accountProduct] : [credentials.appKey];
  const accountScope = createHash('sha256').update(JSON.stringify([provider, 'paper', ...identity])).digest('hex').slice(0, 24);
  const origins = (env.APP_ORIGINS || 'http://127.0.0.1:4174,http://localhost:4174').split(',').map(value => value.trim());
  for (const origin of origins) {
    const parsed = new URL(origin);
    if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.protocol !== 'http:' || parsed.origin !== origin) throw new Error('APP_ORIGINS must contain exact local HTTP origins.');
  }
  return { provider: provider as ServerConfig['provider'], credentials, missing, port, dataDirectory: resolve(env.BROKER_DATA_DIR || '.broker-data'), accountScope, allowedOrigins: origins };
}
