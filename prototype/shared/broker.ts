export type BrokerProvider = 'kis' | 'kiwoom';
export type OrderSide = 'buy' | 'sell';
export type OrderStatus = 'accepted' | 'partially_filled' | 'filled' | 'cancel_pending' | 'cancelled' | 'rejected' | 'unknown';
export interface Quote { symbol: string; name: string; price: number; change: number; percent: number; asOf: string }
export interface Position { symbol: string; name: string; quantity: number; availableQuantity: number; averagePrice?: number }
export interface AccountSnapshot { availableCash: number | null; positions: Position[]; asOf: string }
export interface OrderInput { symbol: string; side: OrderSide; quantity: number; price: number }
export interface BrokerOrder extends OrderInput {
  brokerOrderId: string; status: OrderStatus; filledQuantity: number; remainingQuantity: number;
  submittedAt: string; meta?: Record<string, string>;
}
export interface AppOrder extends OrderInput {
  id: string; brokerOrderId?: string; status: OrderStatus; filledQuantity: number; remainingQuantity: number;
  submittedAt: string; reason?: string;
}
export interface BrokerStatus {
  provider: BrokerProvider | 'demo'; environment: 'paper'; configured: boolean;
  missing: string[]; session: string;
}
